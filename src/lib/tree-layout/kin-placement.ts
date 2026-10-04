/**
 * Placement rules every view shares: which band each drawn person sits in, and which drawn
 * parent a child hangs from. Flat, layers and floors all read these, so the same person lands in
 * the same place relative to their family whatever the mode (ADR-029).
 *
 * The rules are applied to every child, not only step-children: for an ordinary child both
 * parents share one union and the anchor is just the tie-break between them. Special-casing
 * "step" is what would let views disagree.
 */

import type { GraphIndex, ParentLink } from './graph-index.js';
import { PERSON_ROLES, type Band, type FocusSelection, type PersonRole } from './types.js';

/** The part of a selection the rules read, so tests can pass hand-built selections. */
export interface KinInput {
	focusPersonId: FocusSelection['focusPersonId'];
	people: Array<{ id: string }>;
	unions: Array<{ id: string }>;
}

export interface KinBands {
	bands: Map<string, Band>;
	/** Children whose every drawn parent is only a partner of the line. */
	stepChildIds: Set<string>;
}

const MAX_BAND: Band = 2;

/**
 * Bands: 0 the direct line (focus, drawn ancestors and descendants) and every partner of it, 1
 * other children of a line person's union and their partners (and the parents of a partner), 2
 * descendants of band 1 and their partners. A person qualifying for two bands takes the lower, which is why the levels are
 * closed in order. Band 2 is the furthest: anyone further back is a "+N" stub, not a card.
 */
export function assignBands(selection: KinInput, index: GraphIndex): KinBands {
	const drawn = new Set(selection.people.map((p) => p.id));
	const drawnUnions = new Set(selection.unions.map((u) => u.id));

	const parentsOf = (id: string): string[] =>
		(index.parentLinksOfChild.get(id) ?? []).map((l) => l.parentId).filter((p) => drawn.has(p));
	const childrenOf = new Map<string, string[]>();
	// Sorted so the result never depends on the order the selection listed people in.
	for (const id of [...drawn].sort()) {
		for (const parentId of parentsOf(id)) {
			const list = childrenOf.get(parentId) ?? [];
			if (!list.includes(id)) list.push(id);
			childrenOf.set(parentId, list);
		}
	}
	const partnersOf = (id: string): string[] =>
		(index.unionsOfPerson.get(id) ?? [])
			.filter((u) => drawnUnions.has(u.id))
			.flatMap((u) => u.partnerIds)
			.filter((p) => p !== id && drawn.has(p));

	// The direct line: the focus, everyone above by any parent assertion, everyone below.
	const line = new Set<string>();
	if (drawn.has(selection.focusPersonId)) {
		line.add(selection.focusPersonId);
		const up = [selection.focusPersonId];
		while (up.length > 0) {
			for (const parentId of parentsOf(up.shift()!)) {
				if (!line.has(parentId)) {
					line.add(parentId);
					up.push(parentId);
				}
			}
		}
		const down = [selection.focusPersonId];
		while (down.length > 0) {
			for (const childId of childrenOf.get(down.shift()!) ?? []) {
				if (!line.has(childId)) {
					line.add(childId);
					down.push(childId);
				}
			}
		}
	}

	const bands = new Map<string, Band>();
	/** Banded through blood (or the line) rather than only by partnering someone banded. */
	const blood = new Set<string>();
	/** For a partner-only person: who they partner, whose children with them are not step-children. */
	const partneredWith = new Map<string, string>();
	const stepChildIds = new Set<string>();

	/** Band `level` people reached so far whose children and partners are still to follow. */
	function close(level: Band, seeds: string[]): string[] {
		const queue: string[] = [];
		const nextSeeds: string[] = [];
		const take = (id: string, isBlood: boolean) => {
			if (bands.has(id)) return;
			bands.set(id, level);
			if (isBlood) blood.add(id);
			queue.push(id);
		};
		for (const id of seeds) take(id, true);
		while (queue.length > 0) {
			const personId = queue.shift()!;
			for (const partnerId of partnersOf(personId)) {
				if (!bands.has(partnerId)) partneredWith.set(partnerId, personId);
				take(partnerId, false);
			}
			// A partner's own parents are an origin: one step off the line, so the next band, and
			// the parents' other children (the partner's siblings) one further.
			if (!blood.has(personId)) {
				for (const parentId of parentsOf(personId))
					if (!bands.has(parentId)) nextSeeds.push(parentId);
			}
			for (const childId of childrenOf.get(personId) ?? []) {
				if (bands.has(childId)) continue;
				if (line.has(personId)) {
					// Another child of a line person's union: the sibling line, banded next level.
					nextSeeds.push(childId);
				} else if (!blood.has(personId)) {
					// A partner's own child from another union takes the partner's band. A child
					// the partner shares with the person they partner is that person's descendant.
					if (parentsOf(childId).includes(partneredWith.get(personId) ?? '')) continue;
					stepChildIds.add(childId);
					take(childId, true);
				} else if (level === 0 || level === MAX_BAND) {
					take(childId, true);
				} else {
					nextSeeds.push(childId);
				}
			}
		}
		return nextSeeds;
	}

	let seeds = [...line].sort();
	for (const level of [0, 1, 2] as const) {
		seeds = close(
			level,
			seeds.filter((id) => !bands.has(id))
		).sort();
	}
	// Anything left is a drawn person the walk never reached; it stays on the line rather than
	// vanishing, and the tests assert the fixtures never hit this.
	for (const id of drawn) if (!bands.has(id)) bands.set(id, 0);

	return { bands, stepChildIds };
}

/**
 * The drawn parent a child hangs from. Biological parents come first; if none is drawn, any
 * drawn parent will do. Ties go to the lower band, then the earlier partner in the union the
 * child belongs to, then the lower id, so every view reaches the same answer.
 *
 * @returns null when no parent is drawn as a card.
 */
export function stepChildAnchor(
	childId: string,
	selection: Pick<KinInput, 'people'>,
	index: GraphIndex,
	bands: ReadonlyMap<string, Band>
): string | null {
	const drawn = new Set(selection.people.map((p) => p.id));
	const links = (index.parentLinksOfChild.get(childId) ?? []).filter((l) => drawn.has(l.parentId));
	if (links.length === 0) return null;
	const biological = links.filter((l) => l.type === 'biological');
	const pool = biological.length > 0 ? biological : links;

	const partnerPosition = (link: ParentLink): number => {
		const union = link.unionId ? index.unionById.get(link.unionId) : undefined;
		const position = union ? union.partnerIds.indexOf(link.parentId) : -1;
		return position >= 0 ? position : Number.MAX_SAFE_INTEGER;
	};
	const best = new Map<string, number>();
	for (const link of pool) {
		best.set(
			link.parentId,
			Math.min(best.get(link.parentId) ?? Number.MAX_SAFE_INTEGER, partnerPosition(link))
		);
	}
	const candidates = [...best.entries()].map(([id, position]) => ({
		id,
		position,
		band: bands.get(id) ?? 0
	}));
	candidates.sort(
		(a, b) => a.band - b.band || a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
	);
	return candidates[0].id;
}

/**
 * Which plane of the `layers` view each person stands on. It is the band, with one override: the
 * focus person's ancestors (and a step-parent who only partners them) move from the direct line to
 * plane 1, because plane 0 is "the focus union and its descendants" and the families it came from
 * are the sibling group behind it. Kept here, beside the band rules, so layers is a reading of the
 * same selection rather than a fork of it (ADR-029).
 */
export function assignLayerPlanes(
	selection: Pick<KinInput, 'unions'> & {
		people: Array<{ id: string; role: PersonRole; band: Band }>;
	},
	index: GraphIndex
): Map<string, Band> {
	const drawnUnions = new Set(selection.unions.map((u) => u.id));
	const planes = new Map<string, Band>();
	for (const p of selection.people) {
		planes.set(p.id, p.role === PERSON_ROLES.ANCESTOR && p.band === 0 ? 1 : p.band);
	}
	const partnersOf = (id: string): string[] =>
		(index.unionsOfPerson.get(id) ?? [])
			.filter((u) => drawnUnions.has(u.id))
			.flatMap((u) => u.partnerIds)
			.filter((partnerId) => partnerId !== id && planes.has(partnerId));
	for (const p of selection.people) {
		if (p.role !== PERSON_ROLES.PARTNER || p.band !== 0) continue;
		const partners = partnersOf(p.id);
		const isOnlyAncestorsPartner =
			partners.length > 0 &&
			partners.every(
				(id) => selection.people.find((q) => q.id === id)?.role === PERSON_ROLES.ANCESTOR
			);
		if (isOnlyAncestorsPartner) planes.set(p.id, 1);
	}
	return planes;
}
