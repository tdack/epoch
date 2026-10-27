/**
 * A bounded slice of a tree around some people, for the reads that follow descent: the
 * relationship calculator (ancestors of two people and their partners) and the pedigree and
 * descendant charts. Like the focus window it follows relationships outwards instead of reading
 * the whole tree, one query per generation, and it stops at a generation limit and at a total, so a
 * wide or deep tree costs a bounded number of reads.
 *
 * It loads rows and decides nothing about privacy: the caller masks the result for its viewer,
 * which needs the birth and death events this always includes.
 */

import type {
	EventRow,
	IndividualRow,
	ParentChildRow,
	PersonNameRow,
	TreeRows,
	UnionPartnerRow,
	UnionRow
} from '../domain/change-log';
import type { GraphWindowRepository, Ranked } from '../repositories/graph-window-repository';
import { oldFactsBefore } from '../domain/living-state';

/** What privacy and a chart card both need: vitals and the facts that say someone has died. */
const VITAL_EVENT_TYPES = ['BIRT', 'DEAT', 'BURI', 'CREM', 'CHR', 'BAPM'] as const;

/** Most people one window loads. A pedigree of 20 generations could be a million; this is a ceiling. */
const MAX_WINDOW_PEOPLE = 3000;

export interface KinWindowRequest {
	treeId: string;
	startIds: readonly string[];
	/** Generations of parents to load above every start person; null loads none and does not look. */
	ancestorGenerations: number | null;
	/** Generations of children to load below every start person; null loads none and does not look. */
	descendantGenerations: number | null;
	/** Load no partners, those of the start people only, or those of everyone loaded (a descendant chart shows couples). */
	partnersOf: 'none' | 'starts' | 'all';
	/** A restricted viewer's living cutoff, so the window also holds the old facts the rule reads. */
	cutoff?: string;
}

export interface KinWindow {
	rows: TreeRows;
	/** The people asked for that exist in the tree. */
	foundStartIds: string[];
	/** True when parents exist beyond the ancestor generations loaded. */
	hasMoreAbove: boolean;
	/** True when children exist beyond the descendant generations loaded. */
	hasMoreBelow: boolean;
	/** True when the total limit cut the load short, so absence is not proof. */
	isCapped: boolean;
}

const rowsOf = <T>(ranked: Array<Ranked<T>>) =>
	[...ranked].sort((a, b) => a.rid - b.rid).map((r) => r.row);

export async function loadKinWindow(
	repo: GraphWindowRepository,
	request: KinWindowRequest
): Promise<KinWindow> {
	const { treeId } = request;
	const people = new Set<string>(request.startIds);
	const links = new Map<string, Ranked<ParentChildRow>>();
	let hasMoreAbove = false;
	let hasMoreBelow = false;
	let isCapped = false;

	// Generation by generation outwards; a link found twice (as someone's parent link and another's child link) is kept once.
	async function walk(direction: 'child' | 'parent', generations: number | null) {
		if (generations === null) return;
		let frontier = [...request.startIds];
		const seen = new Set(frontier);
		for (let depth = 0; frontier.length > 0; depth++) {
			if (depth >= generations) {
				// One more look says whether the limit hid anything, so a chart can say "more above".
				const [beyond] = await repo.run(repo.linksBy(treeId, direction, frontier));
				if (beyond.length > 0) {
					if (direction === 'child') hasMoreAbove = true;
					else hasMoreBelow = true;
				}
				return;
			}
			const [found] = await repo.run(repo.linksBy(treeId, direction, frontier));
			const next: string[] = [];
			for (const link of found) {
				links.set(link.row.id, link);
				const other = direction === 'child' ? link.row.parentId : link.row.childId;
				people.add(link.row.parentId);
				people.add(link.row.childId);
				if (!seen.has(other)) {
					seen.add(other);
					next.push(other);
				}
			}
			if (people.size > MAX_WINDOW_PEOPLE) {
				isCapped = true;
				return;
			}
			frontier = next;
		}
	}
	await walk('child', request.ancestorGenerations);
	await walk('parent', request.descendantGenerations);

	const partnerOwners =
		request.partnersOf === 'all'
			? [...people]
			: request.partnersOf === 'starts'
				? [...request.startIds]
				: [];
	const [ownPartnerships] = await repo.run(repo.partnerRowsOfPersons(treeId, partnerOwners));
	const unionIds = [...new Set(ownPartnerships.map((p) => p.row.unionId))];
	const [partnerRows, unionRows] = await repo.run(
		repo.partnerRowsOfUnions(treeId, unionIds),
		repo.unionsIn(treeId, unionIds)
	);
	for (const p of partnerRows) people.add(p.row.personId);

	const ids = [...people];
	const [individuals, events, names] = await repo.run(
		repo.individualsIn(treeId, ids),
		repo.eventsOf(
			treeId,
			'INDIVIDUAL',
			ids,
			VITAL_EVENT_TYPES,
			request.cutoff === undefined ? undefined : oldFactsBefore(request.cutoff)
		),
		repo.namesOf(treeId, ids)
	);
	const existing = new Set(individuals.map((i) => i.row.id));
	return {
		rows: {
			individuals: rowsOf<IndividualRow>(individuals),
			personNames: rowsOf<PersonNameRow>(names),
			unions: rowsOf<UnionRow>(unionRows),
			unionPartners: rowsOf<UnionPartnerRow>(partnerRows),
			// A link whose far end is not in the tree (or another tree) is not a relationship here.
			parentChild: rowsOf([...links.values()]).filter(
				(l) => existing.has(l.parentId) && existing.has(l.childId)
			),
			events: rowsOf<EventRow>(events),
			mediaItems: [],
			mediaLinks: [],
			sources: [],
			repositories: [],
			sourceRepositories: [],
			citations: [],
			notes: [],
			noteAttachments: [],
			researchTasks: [],
			subtrees: [],
			placeLocations: []
		},
		foundStartIds: request.startIds.filter((id) => existing.has(id)),
		hasMoreAbove,
		hasMoreBelow,
		isCapped
	};
}
