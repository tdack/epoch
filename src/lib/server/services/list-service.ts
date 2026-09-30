/**
 * The lists: individuals, partnerships and surnames, a page at a time. Ids for the page come from
 * `ListRepository`; the records are filled in with the same bounded reads the record pages use, so
 * no list loads the tree.
 */

import type { DbClient } from '../db';
import type { AuthenticatedContext } from '../domain/identity';
import { GraphWindowRepository } from '../repositories/graph-window-repository';
import { ListRepository } from '../repositories/list-repository';
import { UserRepository } from '../repositories/user-repository';
import { privacyOf } from '../../shared/privacy';
import {
	DEFAULT_LIST_LIMIT,
	INDIVIDUAL_SORTS,
	MAX_LIST_LIMIT,
	type IndividualListItem,
	type IndividualListQuery,
	type Page,
	type SurnameListItem,
	type UnionListItem
} from '../../shared/lists';
import { isSex } from '../../shared/sex';
import { filterForViewer } from './privacy-seam';
import { personSummaries, summaryOfRows } from './person-summaries';
import { requireTreeAction } from './tree-access';

const clampPage = (query: { offset?: number; limit?: number }) => ({
	offset: Math.max(0, query.offset ?? 0),
	limit: Math.min(Math.max(query.limit ?? DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT)
});

/** Facts that end a partnership, in the order a list prefers to quote them. */
const END_EVENT_TYPES = ['DIV', 'ANUL'] as const;

export class ListService {
	private lists: ListRepository;
	private graphRepo: GraphWindowRepository;
	private users: UserRepository;

	constructor(db: DbClient) {
		this.lists = new ListRepository(db);
		this.graphRepo = new GraphWindowRepository(db);
		this.users = new UserRepository(db);
	}

	async individuals(treeId: string, query: Partial<IndividualListQuery>, context: AuthenticatedContext): Promise<Page<IndividualListItem>> {
		await requireTreeAction(this.users, treeId, context, 'tree:view');
		const page = clampPage(query);
		const sort = query.sort ?? INDIVIDUAL_SORTS.SURNAME;
		const { ids, hasMore } = await this.lists.individualIds(treeId, sort, (query.surname ?? '').trim(), page);
		const [people, vitals, names] = await this.graphRepo.run(
			this.graphRepo.individualsIn(treeId, ids),
			this.graphRepo.eventsOf(treeId, 'INDIVIDUAL', ids, ['BIRT', 'DEAT']),
			this.graphRepo.namesOf(ids)
		);
		const byId = new Map(people.map(({ row }) => [row.id, row]));
		const items: IndividualListItem[] = [];
		for (const id of ids) {
			const row = byId.get(id);
			if (!row) continue;
			const summary = summaryOfRows(
				row,
				vitals.filter((e) => e.row.entityId === id).map((e) => e.row),
				names.filter((n) => n.row.personId === id).map((n) => n.row)
			);
			items.push({
				...privacyOf(row),
				id,
				displayName: summary.displayName,
				givenName: row.givenName,
				surname: row.surname,
				xref: row.xrefId ?? null,
				sex: isSex(row.sex) ? row.sex : null,
				birthDate: summary.birthDate,
				deathDate: summary.deathDate,
				isDeceased: summary.isDeceased
			});
		}
		return { items: filterForViewer(items, context), hasMore, ...page };
	}

	async unions(treeId: string, query: { offset?: number; limit?: number }, context: AuthenticatedContext): Promise<Page<UnionListItem>> {
		await requireTreeAction(this.users, treeId, context, 'tree:view');
		const page = clampPage(query);
		const { ids, hasMore } = await this.lists.unionIds(treeId, page);
		const [unionRows, partnerRows, familyEvents] = await this.graphRepo.run(
			this.graphRepo.unionsIn(treeId, ids),
			this.graphRepo.partnerRowsOfUnions(treeId, ids),
			this.graphRepo.eventsOf(treeId, 'FAMILY', ids, ['MARR', ...END_EVENT_TYPES])
		);
		const partnerIds = [...new Set(partnerRows.map((p) => p.row.personId))];
		const summaries = await personSummaries(this.graphRepo, treeId, undefined, partnerIds);
		const byId = new Map(unionRows.map(({ row }) => [row.id, row]));
		const items: UnionListItem[] = [];
		for (const id of ids) {
			const union = byId.get(id);
			if (!union) continue;
			const events = familyEvents.filter((e) => e.row.entityId === id).map((e) => e.row);
			const marriage = events.find((e) => e.type === 'MARR');
			const end = events.find((e) => (END_EVENT_TYPES as readonly string[]).includes(e.type));
			items.push({
				...privacyOf(union),
				id,
				status: union.status,
				partners: partnerRows
					.filter((p) => p.row.unionId === id)
					.sort((a, b) => a.row.order - b.row.order)
					.map((p) => ({ id: p.row.personId, displayName: summaries.get(p.row.personId)?.displayName ?? 'Unknown' })),
				marriageDate: marriage?.dateRaw ?? null,
				marriagePlace: marriage?.place ?? null,
				endDate: end?.dateRaw ?? null
			});
		}
		return { items: filterForViewer(items, context), hasMore, ...page };
	}

	async surnames(treeId: string, query: { offset?: number; limit?: number }, context: AuthenticatedContext): Promise<Page<SurnameListItem>> {
		await requireTreeAction(this.users, treeId, context, 'tree:view');
		const page = clampPage(query);
		const { rows, hasMore } = await this.lists.surnames(treeId, page);
		const items = rows.map((r) => ({ ...privacyOf(r), surname: r.surname, people: r.people }));
		return { items: filterForViewer(items, context), hasMore, ...page };
	}
}
