/**
 * Places (Phase 1 `place_ref`, Phase 3 item 4): the list of places a tree's facts name, and the
 * facts at one place. The visibility rule is in the queries (`place-repository.ts`), so counts,
 * paging and what a place page lists are over what the viewer may see. A place whose every fact is
 * private answers exactly as a place nobody wrote does.
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { DbClient } from '../db';
import { individuals, unionPartners } from '../db/schema';
import { NotFoundError } from '../domain/errors';
import type { AuthenticatedContext } from '../domain/identity';
import { eventLabel } from '../domain/tree-labels';
import { PlaceRepository } from '../repositories/place-repository';
import { TreeRepository } from '../repositories/tree-repository';
import { UserRepository } from '../repositories/user-repository';
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT, type Page } from '../../shared/lists';
import { placeText, type PlaceDto, type PlaceFactDto, type PlaceListItem } from '../../shared/places';
import { personName } from './kinship-service';
import { requireTreeScope } from './tree-access';

const IDS_PER_QUERY = 80;
const chunks = <T>(items: readonly T[]): T[][] => Array.from({ length: Math.ceil(items.length / IDS_PER_QUERY) }, (_, i) => items.slice(i * IDS_PER_QUERY, (i + 1) * IDS_PER_QUERY));
const clampPage = (query: { offset?: number; limit?: number }) => ({
	offset: Math.max(0, query.offset ?? 0),
	limit: Math.min(Math.max(query.limit ?? DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT)
});

export class PlaceService {
	private places: PlaceRepository;
	private users: UserRepository;
	private trees: TreeRepository;

	constructor(
		private db: DbClient,
		private now: () => Date = () => new Date()
	) {
		this.places = new PlaceRepository(db);
		this.users = new UserRepository(db);
		this.trees = new TreeRepository(db);
	}

	/** One page of places, optionally only those whose text contains `query` (any ASCII case). */
	async list(treeId: string, query: { q?: string; offset?: number; limit?: number }, context: AuthenticatedContext): Promise<Page<PlaceListItem>> {
		const scope = await requireTreeScope(this.users, this.trees, treeId, context, 'tree:view', this.now());
		const page = clampPage(query);
		const { rows, hasMore } = await this.places.list(treeId, placeText(query.q ?? ''), page, scope);
		return { items: rows.map((r) => ({ name: r.name, facts: r.facts, people: r.people })), hasMore, ...page };
	}

	async detail(treeId: string, name: string, query: { offset?: number; limit?: number }, context: AuthenticatedContext): Promise<PlaceDto> {
		const scope = await requireTreeScope(this.users, this.trees, treeId, context, 'tree:view', this.now());
		const page = clampPage(query);
		const { rows, hasMore } = await this.places.facts(treeId, placeText(name), page, scope);
		if (rows.length === 0 && page.offset === 0) throw new NotFoundError('Place', name);

		const personIds = [...new Set(rows.filter((r) => r.entityType === 'INDIVIDUAL').map((r) => r.entityId))];
		const unionIds = [...new Set(rows.filter((r) => r.entityType === 'FAMILY').map((r) => r.entityId))];
		const names = new Map<string, string>();
		for (const chunk of chunks(personIds)) {
			for (const p of await this.db.select({ id: individuals.id, givenName: individuals.givenName, surname: individuals.surname }).from(individuals).where(and(eq(individuals.treeId, treeId), inArray(individuals.id, chunk)))) names.set(p.id, personName(p));
		}
		const partners = new Map<string, string[]>();
		for (const chunk of chunks(unionIds)) {
			const found = await this.db
				.select({ unionId: unionPartners.unionId, givenName: individuals.givenName, surname: individuals.surname, id: individuals.id })
				.from(unionPartners)
				.innerJoin(individuals, eq(individuals.id, unionPartners.personId))
				.where(and(eq(individuals.treeId, treeId), inArray(unionPartners.unionId, chunk)));
			for (const p of found) partners.set(p.unionId, [...(partners.get(p.unionId) ?? []), personName(p)]);
		}
		const facts: PlaceFactDto[] = rows.map((r) => ({
			id: r.id,
			label: eventLabel(r.type),
			dateText: r.dateRaw,
			kind: r.entityType === 'INDIVIDUAL' ? 'person' : 'partnership',
			entityId: r.entityId,
			entityName: r.entityType === 'INDIVIDUAL' ? (names.get(r.entityId) ?? r.entityId) : ([...(partners.get(r.entityId) ?? [])].sort().join(' & ') || 'Partnership')
		}));
		return { name: rows[0]?.place ?? placeText(name), facts, hasMore, ...page };
	}
}
