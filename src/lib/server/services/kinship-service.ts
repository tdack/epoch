/**
 * How two people are related (Phase 3 item 8). Loads the ancestors of both and of their partners
 * through the bounded kin window, masks the rows for the viewer exactly as the record pages do, and
 * hands them to the pure calculator, so a relationship can run through a private person only where
 * the tree's setting would show that person as a placeholder.
 */

import type { DbClient } from '../db';
import type { AuthenticatedContext } from '../domain/identity';
import type { EventRow, TreeRows } from '../domain/change-log';
import { PRIVATE_PLACEHOLDER_NAME, requireVisibleSubject } from '../domain/privacy-mask';
import {
	findRelationships,
	MAX_GENERATIONS,
	type KinGraph
} from '../domain/relationship-calculator';
import { GraphWindowRepository } from '../repositories/graph-window-repository';
import { TreeRepository } from '../repositories/tree-repository';
import { UserRepository } from '../repositories/user-repository';
import {
	MAX_KIN_LIST_GENERATIONS,
	type KinListDto,
	type KinListEntryDto,
	type KinRouteDto,
	type RelationshipDto
} from '../../shared/kinship';
import { ValidationError } from '../domain/errors';
import { loadKinWindow } from './kin-window';
import { requireTreeScope } from './tree-access';

/** Display name for a card or a sentence: "Given Surname", or the id when a person has neither. */
export function personName(row: {
	id: string;
	givenName: string | null;
	surname: string | null;
}): string {
	return [row.givenName, row.surname].filter(Boolean).join(' ') || row.id;
}

function kinGraphOf(rows: TreeRows, placeholderIds: ReadonlySet<string>): KinGraph {
	return {
		people: new Map(
			rows.individuals.map((i) => [
				i.id,
				{ name: personName(i), sex: i.sex, isPrivate: placeholderIds.has(i.id) }
			])
		),
		links: rows.parentChild.map((l) => ({
			parentId: l.parentId,
			childId: l.childId,
			type: l.type
		})),
		partners: partnersFromRows(rows)
	};
}

function partnersFromRows(rows: TreeRows): Map<string, string[]> {
	const byUnion = new Map<string, string[]>();
	for (const p of rows.unionPartners)
		byUnion.set(p.unionId, [...(byUnion.get(p.unionId) ?? []), p.personId]);
	const partners = new Map<string, string[]>();
	for (const members of byUnion.values()) {
		for (const a of members)
			for (const b of members)
				if (a !== b && !partners.get(a)?.includes(b))
					partners.set(a, [...(partners.get(a) ?? []), b]);
	}
	return partners;
}

export class KinshipService {
	private repo: GraphWindowRepository;
	private users: UserRepository;
	private trees: TreeRepository;

	constructor(
		db: DbClient,
		private now: () => Date = () => new Date()
	) {
		this.repo = new GraphWindowRepository(db);
		this.users = new UserRepository(db);
		this.trees = new TreeRepository(db);
	}

	async relationship(
		treeId: string,
		fromId: string,
		toId: string,
		context: AuthenticatedContext
	): Promise<RelationshipDto> {
		const scope = await requireTreeScope(
			this.users,
			this.trees,
			treeId,
			context,
			'tree:view',
			this.now()
		);

		// Partners are start people too: a relative of a partner is a route by partnership.
		const [ownPartnerships] = await this.repo.run(
			this.repo.partnerRowsOfPersons(treeId, [fromId, toId])
		);
		const unionIds = [...new Set(ownPartnerships.map((p) => p.row.unionId))];
		const [partnerRows] = await this.repo.run(this.repo.partnerRowsOfUnions(treeId, unionIds));
		const startIds = [...new Set([fromId, toId, ...partnerRows.map((p) => p.row.personId)])];
		const window = await loadKinWindow(this.repo, {
			treeId,
			startIds,
			ancestorGenerations: MAX_GENERATIONS,
			descendantGenerations: null,
			partnersOf: 'starts',
			cutoff: scope.isRestricted ? scope.cutoff : undefined
		});

		const { rows, placeholderIds } = requireVisibleSubject(window, [fromId, toId], scope);
		const graph = kinGraphOf(rows, placeholderIds);
		const people = graph.people;
		const result = findRelationships(fromId, toId, graph);
		const ref = (id: string) => ({
			id,
			name: people.get(id)?.isPrivate ? PRIVATE_PLACEHOLDER_NAME : (people.get(id)?.name ?? id),
			isPrivate: people.get(id)?.isPrivate ?? false
		});
		const routes: KinRouteDto[] = result.routes.map((r) => ({
			kind: r.kind,
			label: r.label,
			steps: r.steps.map((s) => ({
				...ref(s.personId),
				relation: s.relation,
				linkType: s.linkType
			})),
			viaNames: r.viaIds.map((id) => ref(id).name),
			nonBiologicalTypes: r.nonBiologicalTypes
		}));
		return {
			from: ref(fromId),
			to: ref(toId),
			routes,
			isIncomplete: result.isIncomplete || window.hasMoreAbove || window.isCapped
		};
	}
	/**
	 * Everyone the viewer may see who is related to one person: blood relatives up to `generations`
	 * above them and every line down from those ancestors to one generation below the person, plus
	 * their partners. Two bounded window loads, then the calculator in memory, so the cost is one
	 * read per generation however many relatives there are.
	 */
	async kinshipList(
		treeId: string,
		personId: string,
		generations: number,
		context: AuthenticatedContext
	): Promise<KinListDto> {
		if (!Number.isInteger(generations) || generations < 1 || generations > MAX_KIN_LIST_GENERATIONS)
			throw new ValidationError(
				`Generations must be a whole number from 1 to ${MAX_KIN_LIST_GENERATIONS}`
			);
		const scope = await requireTreeScope(
			this.users,
			this.trees,
			treeId,
			context,
			'tree:view',
			this.now()
		);
		const cutoff = scope.isRestricted ? scope.cutoff : undefined;
		const up = await loadKinWindow(this.repo, {
			treeId,
			startIds: [personId],
			ancestorGenerations: generations,
			descendantGenerations: null,
			partnersOf: 'none',
			cutoff
		});
		// Walking down from every ancestor also picks up the links between them, so this one window holds the whole family.
		const window = await loadKinWindow(this.repo, {
			treeId,
			startIds: [personId, ...up.rows.individuals.map((i) => i.id).filter((id) => id !== personId)],
			ancestorGenerations: null,
			descendantGenerations: generations + 1,
			partnersOf: 'starts',
			cutoff
		});
		const { rows, placeholderIds } = requireVisibleSubject(
			{ rows: window.rows, foundStartIds: up.foundStartIds },
			personId,
			scope
		);
		const graph = kinGraphOf(rows, placeholderIds);

		const firstOf = (events: EventRow[], type: string) =>
			events
				.filter((e) => e.type === type)
				.sort((a, b) => (a.dateSort ?? '').localeCompare(b.dateSort ?? ''))[0]?.dateRaw ?? null;
		const eventsBy = Map.groupBy(
			rows.events.filter((e) => e.entityType === 'INDIVIDUAL'),
			(e) => e.entityId
		);
		const entries: KinListEntryDto[] = rows.individuals.flatMap((i) => {
			if (i.id === personId || placeholderIds.has(i.id)) return [];
			const route = findRelationships(personId, i.id, graph).routes[0];
			if (!route) return [];
			const own = eventsBy.get(i.id) ?? [];
			return [
				{
					id: i.id,
					name: personName(i),
					label: route.label,
					distance: route.steps.length - 1,
					birth: firstOf(own, 'BIRT'),
					death: firstOf(own, 'DEAT')
				}
			];
		});
		entries.sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name));
		const subject = graph.people.get(personId)!;
		return {
			person: { id: personId, name: subject.name, isPrivate: false },
			generations,
			entries,
			isIncomplete: up.hasMoreAbove || up.isCapped || window.hasMoreBelow || window.isCapped
		};
	}
}
