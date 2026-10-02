/**
 * Focus-centred tree layout: selection (which people and unions), hourglass placement, and edge
 * generation. Pure functions over a {@link RelationshipGraph}; no DOM, no Svelte.
 */

import { buildEdges } from './edges.js';
import { buildIndex } from './graph-index.js';
import { placeHourglass, type Item } from './place.js';
import { selectFocusSubgraph } from './select.js';
import {
	EMPTY_LAYOUT,
	LAYOUT_METRICS,
	type FocusViewOptions,
	type LayoutMetrics,
	type PlacedCollapser,
	type PlacedPerson,
	type PlacedStub,
	type PlacedUnion,
	type RelationshipGraph,
	type TreeLayout
} from './types.js';

export * from './types.js';
export { selectFocusSubgraph } from './select.js';
export { filterParentChildTypes } from './filter.js';
export { countCrossings, allContractViolations } from './contract.js';

/** Distance below a card row at which a hanging union node sits. */
function hangOffset(m: LayoutMetrics): number {
	return m.cardHeight / 2 + m.unionRadius + 4;
}

function clean(value: number): number {
	// Avoids -0 and float dust so identical inputs compare equal and serialise identically.
	const rounded = Math.round(value * 1000) / 1000;
	return rounded === 0 ? 0 : rounded;
}

/**
 * Lay out the hourglass around `focusPersonId`. Returns an empty layout when the person is not
 * in the graph.
 */
export function layoutFocusView(
	graph: RelationshipGraph,
	focusPersonId: string | null | undefined,
	options: FocusViewOptions = {},
	m: LayoutMetrics = LAYOUT_METRICS
): TreeLayout {
	if (!focusPersonId) return EMPTY_LAYOUT;
	const index = buildIndex(graph);
	const selection = selectFocusSubgraph(graph, focusPersonId, options, index);
	if (!selection) return EMPTY_LAYOUT;

	const placement = placeHourglass(index, selection, m);
	const items: Item[] = [...placement.items];
	const nonAdjacent = new Set(placement.nonAdjacentUnionIds);

	// Anything selected but not reached by the placement is appended to its row rather than
	// silently dropped; the contract tests fail if this ever triggers on the fixtures.
	const rowRight = new Map<number, number>();
	for (const item of items) {
		if (item.t === 'union') continue;
		rowRight.set(item.gen, Math.max(rowRight.get(item.gen) ?? -Infinity, item.x + m.cardWidth / 2));
	}
	const havePerson = new Set(items.filter((i) => i.t === 'person').map((i) => i.id));
	const misplaced: string[] = [];
	for (const p of selection.people) {
		if (havePerson.has(p.id)) continue;
		const x =
			(rowRight.get(p.generation) ?? -m.siblingGap - m.cardWidth / 2) +
			m.siblingGap +
			m.cardWidth / 2;
		rowRight.set(p.generation, x + m.cardWidth / 2);
		items.push({ t: 'person', id: p.id, gen: p.generation, x });
		misplaced.push(p.id);
	}
	const haveUnion = new Set(items.filter((i) => i.t === 'union').map((i) => i.id));
	for (const u of selection.unions) {
		if (haveUnion.has(u.id)) continue;
		const partnerXs = items
			.filter((i) => i.t === 'person' && index.unionById.get(u.id)!.partnerIds.includes(i.id))
			.map((i) => i.x);
		const x = partnerXs.length > 0 ? partnerXs.reduce((a, b) => a + b, 0) / partnerXs.length : 0;
		items.push({ t: 'union', id: u.id, gen: u.generation, x, isHanging: true });
		nonAdjacent.add(u.id);
	}

	// A graph read while an import was still writing can name a person whose row has not arrived
	// (seen in the browser; the served window is consistent once the import ends, and the next read
	// replaces this one). Drawing a card with no record behind it throws, so leave that person out.
	// Not done in `selectFocusSubgraph`: the window loader relies on it naming people not yet loaded.
	for (let i = items.length - 1; i >= 0; i--) {
		if (items[i].t === 'person' && !index.personById.has(items[i].id)) items.splice(i, 1);
	}

	const roleOf = new Map(selection.people.map((p) => [p.id, p.role]));
	const people: PlacedPerson[] = [];
	const unions: PlacedUnion[] = [];
	const stubs: PlacedStub[] = [];
	const stubById = new Map(selection.stubs.map((s) => [s.id, s]));
	for (const item of items) {
		const x = clean(item.x);
		if (item.t === 'person') {
			people.push({
				id: item.id,
				x,
				y: item.gen * m.rowHeight,
				generation: item.gen,
				role: roleOf.get(item.id)!,
				person: index.personById.get(item.id)!
			});
		} else if (item.t === 'union') {
			unions.push({
				id: item.id,
				x,
				y: item.gen * m.rowHeight + (item.isHanging ? hangOffset(m) : 0),
				generation: item.gen,
				isHanging: item.isHanging,
				union: index.unionById.get(item.id)!
			});
		} else {
			const s = stubById.get(item.id)!;
			stubs.push({
				id: s.id,
				kind: s.kind,
				personId: s.personId,
				unionId: s.unionId,
				count: s.count,
				x,
				y: item.gen * m.rowHeight,
				generation: item.gen
			});
		}
	}
	const byRowThenX = (a: { generation: number; x: number; id: string }, b: typeof a) =>
		a.generation - b.generation || a.x - b.x || a.id.localeCompare(b.id);
	people.sort(byRowThenX);
	unions.sort(byRowThenX);
	stubs.sort(byRowThenX);

	const placedPeople = new Map(people.map((p) => [p.id, p]));
	const placedUnions = new Map(unions.map((u) => [u.id, u]));
	const collapsers: PlacedCollapser[] = [];
	for (const e of selection.expansions) {
		const person = placedPeople.get(e.personId);
		const union = e.unionId ? placedUnions.get(e.unionId) : undefined;
		// Sits where the stub was: above the card for ancestors, below the union or card for children.
		const at =
			e.kind === 'ancestors' && person
				? { x: person.x, y: person.y - m.cardHeight / 2 }
				: union
					? { x: union.x, y: union.y + m.unionRadius + 12 }
					: person
						? { x: person.x + m.cardWidth / 2 - 18, y: person.y + m.cardHeight / 2 }
						: null;
		if (at) collapsers.push({ ...e, x: clean(at.x), y: clean(at.y) });
	}

	const directLinks = graph.parentChild.filter((pc) => pc.unionId === null);
	const edges = buildEdges(
		index,
		selection,
		new Map(people.map((p) => [p.id, p])),
		new Map(unions.map((u) => [u.id, u])),
		stubs,
		placement.primaryEdgeKeys,
		directLinks
	);

	const xs = [...people.map((p) => p.x), ...stubs.map((s) => s.x)];
	const gens = [...people.map((p) => p.generation), ...stubs.map((s) => s.generation)];
	return {
		focusPersonId,
		people,
		unions,
		stubs,
		collapsers,
		edges,
		collapsedPersonIds: selection.collapsedPersonIds,
		nonAdjacentUnionIds: [...nonAdjacent].sort(),
		misplacedPersonIds: misplaced,
		bounds: {
			minX: Math.min(...xs) - m.cardWidth / 2,
			maxX: Math.max(...xs) + m.cardWidth / 2,
			minY: Math.min(...gens) * m.rowHeight - m.cardHeight / 2,
			maxY: Math.max(...gens) * m.rowHeight + m.cardHeight / 2
		}
	};
}
