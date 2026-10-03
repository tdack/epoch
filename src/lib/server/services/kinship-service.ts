/**
 * How two people are related (Phase 3 item 8). Loads the ancestors of both and of their partners
 * through the bounded kin window, masks the rows for the viewer exactly as the record pages do, and
 * hands them to the pure calculator, so a relationship can run through a private person only where
 * the tree's setting would show that person as a placeholder.
 */

import type { DbClient } from '../db';
import type { AuthenticatedContext } from '../domain/identity';
import type { TreeRows } from '../domain/change-log';
import { PRIVATE_PLACEHOLDER_NAME, requireVisibleSubject } from '../domain/privacy-mask';
import {
	findRelationships,
	MAX_GENERATIONS,
	type KinGraph
} from '../domain/relationship-calculator';
import { GraphWindowRepository } from '../repositories/graph-window-repository';
import { TreeRepository } from '../repositories/tree-repository';
import { UserRepository } from '../repositories/user-repository';
import type { KinRouteDto, RelationshipDto } from '../../shared/kinship';
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
			partnersOf: 'starts'
		});

		const { rows, placeholderIds } = requireVisibleSubject(window, [fromId, toId], scope);
		const people = new Map(
			rows.individuals.map((i) => [
				i.id,
				{ name: personName(i), sex: i.sex, isPrivate: placeholderIds.has(i.id) }
			])
		);
		const graph: KinGraph = {
			people,
			links: rows.parentChild.map((l) => ({
				parentId: l.parentId,
				childId: l.childId,
				type: l.type
			})),
			partners: partnersFromRows(rows)
		};
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
}
