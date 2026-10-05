/**
 * The `layers` layout: upright planes, one behind another, centred on a focus union. Plane 0 is
 * the union and its descendants, plane 1 the families it came from (ancestors and the sibling
 * line), plane 2 the cousin line. Within a plane, rows are generations, drawn in the same
 * coordinates as the flat hourglass. Left to right always means whose side: the first partner of
 * the union and their relatives to the left, the second partner and theirs to the right, in
 * `union_partner` order and never by sex (ADR-030).
 *
 * x starts from the flat hourglass so switching view does not reshuffle anyone. Splitting
 * generations into planes leaves holes, which `compactRows` closes; people the hourglass has no
 * slot for (aunts, cousins, a partner's family) and the placeholders that join planes are then put
 * in the nearest free spot of their own row.
 */

import { buildEdges } from './edges.js';
import { buildIndex, type GraphIndex } from './graph-index.js';
import { layoutFocusView } from './index.js';
import { assignLayerPlanes } from './kin-placement.js';
import {
	compactRows,
	nearestFreeX,
	pairKey,
	type RowItem,
	type Standing
} from './row-placement.js';
import { selectFocusSubgraph } from './select.js';
import {
	LAYOUT_METRICS,
	PERSON_ROLES,
	type Band,
	type FocusSelection,
	type FocusViewOptions,
	type LayoutEdge,
	type LayoutMetrics,
	type PersonRole,
	type PlacedCollapser,
	type PlacedPerson,
	type PlacedStub,
	type PlacedUnion,
	type RelationshipGraph,
	type RelationshipGraphPerson,
	type RelationshipGraphUnion
} from './types.js';

/** Which of the union's two partners a person's family hangs from. */
export const LAYER_SIDES = { FIRST: 'first', CENTRE: 'centre', SECOND: 'second' } as const;
type LayerSide = (typeof LAYER_SIDES)[keyof typeof LAYER_SIDES];

/** Left-to-right order of the sides within any row. */
const SIDE_RANK: Record<LayerSide, number> = { first: 0, centre: 1, second: 2 };

export interface LayerPerson {
	id: string;
	x: number;
	/** Row within the plane, relative to the focus: negative above. */
	generation: number;
	plane: Band;
	/** The band selection gave them; the plane is this, bar the ancestors' override. */
	band: Band;
	side: LayerSide;
	role: PersonRole;
	anchorParentId: string | null;
	isStepChild: boolean;
	person: RelationshipGraphPerson;
}

/**
 * A dashed stand-in for a person who is drawn in full on another plane. It sits where the
 * relationship that reaches them lands (a child under its parents' union), so a plane reads
 * complete, and a depth link joins it to the real card.
 */
interface LayerGhost {
	id: string;
	personId: string;
	plane: Band;
	generation: number;
	x: number;
	side: LayerSide;
	person: RelationshipGraphPerson;
}

interface LayerUnion {
	id: string;
	x: number;
	generation: number;
	/** The nearest plane any drawn partner stands on. */
	plane: Band;
	isHanging: boolean;
	union: RelationshipGraphUnion;
}

interface LayerStub extends PlacedStub {
	plane: Band;
}

interface LayerCollapser extends PlacedCollapser {
	plane: Band;
}

/** An edge drawn inside one plane, in that plane's coordinates (y is the row, as in flat). */
type LayerEdge = LayoutEdge & { plane: Band };

interface LayerEnd {
	plane: Band;
	generation: number;
	x: number;
}

/** The line that joins a placeholder to the real card of the same person on another plane. */
interface DepthLink {
	id: string;
	personId: string;
	from: LayerEnd;
	to: LayerEnd;
}

interface LayerPlane {
	plane: Band;
	/** Rows that hold something on this plane, ascending. */
	generations: number[];
}

interface UnionChoice {
	id: string;
	/** The other partners' names, which is what tells two unions of one person apart. */
	label: string;
}

export interface LayersLayout {
	focusPersonId: string | null;
	/** The union the planes are centred on; null when the focus person has none. */
	focusUnionId: string | null;
	unionChoices: UnionChoice[];
	planes: LayerPlane[];
	people: LayerPerson[];
	ghosts: LayerGhost[];
	unions: LayerUnion[];
	stubs: LayerStub[];
	edges: LayerEdge[];
	depthLinks: DepthLink[];
	collapsers: LayerCollapser[];
	collapsedPersonIds: string[];
	bounds: { minX: number; maxX: number; minGeneration: number; maxGeneration: number };
}

const EMPTY_LAYERS: LayersLayout = {
	focusPersonId: null,
	focusUnionId: null,
	unionChoices: [],
	planes: [],
	people: [],
	ghosts: [],
	unions: [],
	stubs: [],
	edges: [],
	depthLinks: [],
	collapsers: [],
	collapsedPersonIds: [],
	bounds: { minX: 0, maxX: 0, minGeneration: 0, maxGeneration: 0 }
};

function clean(value: number): number {
	const rounded = Math.round(value * 1000) / 1000;
	return rounded === 0 ? 0 : rounded;
}

/**
 * The side of every drawn person. The union's first partner and everyone above them hang from the
 * first side, the second partner and their ancestors from the second, and the union's children and
 * what grows from them stand in the centre. Everyone else takes the side of the person they hang
 * from, and a partner the side of whoever they partner.
 */
function assignSides(
	selection: FocusSelection,
	index: GraphIndex,
	focusUnion: RelationshipGraphUnion | null
): Map<string, LayerSide> {
	const drawn = new Set(selection.people.map((p) => p.id));
	const sides = new Map<string, LayerSide>();
	const parentsOf = (id: string) =>
		(index.parentLinksOfChild.get(id) ?? []).map((l) => l.parentId).filter((p) => drawn.has(p));

	const markWithAncestors = (rootId: string, side: LayerSide) => {
		const queue = [rootId];
		while (queue.length > 0) {
			const id = queue.shift()!;
			if (sides.has(id)) continue;
			sides.set(id, side);
			queue.push(...parentsOf(id));
		}
	};
	const partners = focusUnion ? focusUnion.partnerIds.filter((id) => drawn.has(id)) : [];
	const [first = selection.focusPersonId, ...others] = partners;
	markWithAncestors(first, LAYER_SIDES.FIRST);
	for (const id of others) markWithAncestors(id, LAYER_SIDES.SECOND);

	if (focusUnion) {
		for (const [childId, links] of index.parentLinksOfChild) {
			if (!drawn.has(childId) || sides.has(childId)) continue;
			if (links.some((l) => l.unionId === focusUnion.id)) sides.set(childId, LAYER_SIDES.CENTRE);
		}
	}

	const ids = [...drawn].sort();
	const anchorOf = new Map(selection.people.map((p) => [p.id, p.anchorParentId]));
	const drawnUnions = new Set(selection.unions.map((u) => u.id));
	const partnersOf = (id: string) =>
		(index.unionsOfPerson.get(id) ?? [])
			.filter((u) => drawnUnions.has(u.id))
			.flatMap((u) => u.partnerIds)
			.filter((p) => p !== id && drawn.has(p));
	for (let isChanging = true; isChanging;) {
		isChanging = false;
		for (const id of ids) {
			if (sides.has(id)) continue;
			const via = [anchorOf.get(id) ?? '', ...partnersOf(id), ...parentsOf(id)].find((other) =>
				sides.has(other)
			);
			if (via !== undefined) {
				sides.set(id, sides.get(via)!);
				isChanging = true;
			}
		}
	}
	for (const id of ids) if (!sides.has(id)) sides.set(id, LAYER_SIDES.CENTRE);
	return sides;
}

/**
 * Lay out the planes around `focusPersonId`, centred on `unionId` (else the focus person's first
 * union). Returns an empty layout when the person is not in the graph.
 */
export function layoutLayers(
	graph: RelationshipGraph,
	focusPersonId: string | null | undefined,
	unionId: string | null | undefined,
	options: FocusViewOptions = {},
	m: LayoutMetrics = LAYOUT_METRICS
): LayersLayout {
	if (!focusPersonId) return EMPTY_LAYERS;
	const index = buildIndex(graph);
	const selection = selectFocusSubgraph(graph, focusPersonId, options, index);
	if (!selection) return EMPTY_LAYERS;
	const flat = layoutFocusView(graph, focusPersonId, options, m);

	const drawnUnionIds = new Set(selection.unions.map((u) => u.id));
	const choices = (index.unionsOfPerson.get(focusPersonId) ?? []).filter((u) =>
		drawnUnionIds.has(u.id)
	);
	const focusUnion = choices.find((u) => u.id === unionId) ?? choices[0] ?? null;
	const unionChoices = choices.map((u) => ({
		id: u.id,
		label:
			u.partnerIds
				.filter((id) => id !== focusPersonId)
				.map((id) => index.personById.get(id)?.displayName)
				.filter((name) => !!name)
				.join(' & ') || 'Unnamed partnership'
	}));

	const selected = new Map(selection.people.map((p) => [p.id, p]));
	const planeOf = assignLayerPlanes(selection, index);
	const sideOf = assignSides(selection, index, focusUnion);
	const plane = (id: string): Band => planeOf.get(id) ?? 0;
	const side = (id: string): LayerSide => sideOf.get(id) ?? LAYER_SIDES.CENTRE;
	const unionPlane = (u: RelationshipGraphUnion): Band => {
		const planes = u.partnerIds.filter((id) => selected.has(id)).map(plane);
		return planes.length > 0 ? (Math.min(...planes) as Band) : 0;
	};
	const unionPlanes = new Map(
		selection.unions.map((u) => [u.id, unionPlane(index.unionById.get(u.id)!)])
	);

	// ---- x: the hourglass, compacted per plane ----
	const misplaced = new Set(flat.misplacedPersonIds);
	const flatPeople = flat.people.filter((p) => !misplaced.has(p.id));
	const stubPlane = (stub: { unionId: string | null; personId: string }): Band =>
		(stub.unionId ? unionPlanes.get(stub.unionId) : undefined) ?? plane(stub.personId);
	const partnerPairs = new Set<string>();
	for (const u of selection.unions) {
		const ids = index.unionById.get(u.id)!.partnerIds.filter((id) => selected.has(id));
		for (let i = 0; i + 1 < ids.length; i++)
			partnerPairs.add(pairKey(`p:${ids[i]}`, `p:${ids[i + 1]}`));
	}
	const rowItems: RowItem[] = [
		...flatPeople.map((p) => ({
			key: `p:${p.id}`,
			x: p.x,
			width: m.cardWidth,
			generation: p.generation,
			group: plane(p.id)
		})),
		...flat.stubs.map((s) => ({
			key: `s:${s.id}`,
			x: s.x,
			width: m.stubWidth,
			generation: s.generation,
			group: stubPlane(s)
		}))
	];
	const x = compactRows(rowItems, [0, 1, 2], partnerPairs, m);

	// ---- Ghosts: who needs a stand-in on which plane ----
	const peopleOnPlane = new Map<string, Band>(selection.people.map((p) => [p.id, plane(p.id)]));
	const ghostWanted = new Map<string, { personId: string; plane: Band }>();
	const wantGhost = (childId: string, onPlane: Band) => {
		const child = index.personById.get(childId);
		// A private person stays a placeholder and is never joined to anything across planes.
		if (!selected.has(childId) || child?.isPrivate === true) return;
		if (peopleOnPlane.get(childId) === onPlane) return;
		ghostWanted.set(`${childId}@${onPlane}`, { personId: childId, plane: onPlane });
	};
	for (const u of selection.unions) {
		const union = index.unionById.get(u.id)!;
		for (const childId of new Set(union.children.map((c) => c.childId))) {
			wantGhost(childId, unionPlanes.get(u.id)!);
		}
	}
	const directLinks = graph.parentChild.filter(
		(pc) => pc.unionId === null && selected.has(pc.parentId) && selected.has(pc.childId)
	);
	for (const link of directLinks) wantGhost(link.childId, plane(link.parentId));

	// ---- Everyone the hourglass left out is put in the nearest free spot of their row ----
	const standing = new Map<string, Standing[]>();
	const rowKey = (onPlane: Band, generation: number) => `${onPlane}|${generation}`;
	const stand = (onPlane: Band, generation: number, item: Standing) => {
		const key = rowKey(onPlane, generation);
		standing.set(key, [...(standing.get(key) ?? []), item]);
	};
	const rowOf = new Map<string, { plane: Band; generation: number }>();
	for (const p of flatPeople) {
		rowOf.set(`p:${p.id}`, { plane: plane(p.id), generation: p.generation });
		stand(plane(p.id), p.generation, {
			key: `p:${p.id}`,
			x: x.get(`p:${p.id}`)!,
			width: m.cardWidth
		});
	}
	for (const s of flat.stubs) {
		stand(stubPlane(s), s.generation, {
			key: `s:${s.id}`,
			x: x.get(`s:${s.id}`)!,
			width: m.stubWidth
		});
	}

	const childrenOf = new Map<string, string[]>();
	for (const id of selected.keys()) {
		for (const link of index.parentLinksOfChild.get(id) ?? []) {
			if (selected.has(link.parentId))
				childrenOf.set(link.parentId, [...(childrenOf.get(link.parentId) ?? []), id]);
		}
	}
	const unionXOf = (unionIdValue: string, seen: Set<string>): number | null => {
		const union = index.unionById.get(unionIdValue);
		if (!union) return null;
		const xs = union.partnerIds
			.filter((id) => selected.has(id))
			.map((id) => estimate(id, seen))
			.filter((v) => v !== null);
		return xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
	};
	/** Where a person is, or would be: placed, else under their parents, else over their children. */
	function estimate(id: string, seen: Set<string>): number | null {
		const placed = x.get(`p:${id}`);
		if (placed !== undefined) return placed;
		if (seen.has(id)) return null;
		seen.add(id);
		const mean = (values: Array<number | null>) => {
			const found = values.filter((v) => v !== null);
			return found.length > 0 ? found.reduce((a, b) => a + b, 0) / found.length : null;
		};
		const links = (index.parentLinksOfChild.get(id) ?? []).filter((l) => selected.has(l.parentId));
		const unionIds = [...new Set(links.flatMap((l) => (l.unionId ? [l.unionId] : [])))].filter(
			(u) => drawnUnionIds.has(u)
		);
		const fromParents = mean([
			...unionIds.map((u) => unionXOf(u, seen)),
			...links.filter((l) => !l.unionId).map((l) => estimate(l.parentId, seen))
		]);
		if (fromParents !== null) return fromParents;
		const partnerIds = (index.unionsOfPerson.get(id) ?? [])
			.filter((u) => drawnUnionIds.has(u.id))
			.flatMap((u) => u.partnerIds)
			.filter((p) => p !== id && selected.has(p));
		const fromPartners = mean(partnerIds.map((p) => x.get(`p:${p}`) ?? null));
		if (fromPartners !== null) return fromPartners;
		return mean((childrenOf.get(id) ?? []).map((c) => estimate(c, seen)));
	}

	interface Newcomer {
		key: string;
		plane: Band;
		generation: number;
		width: number;
		/** Partners go after the people they partner, so they can land beside them. */
		order: number;
		desired: () => number;
	}
	const newcomers: Newcomer[] = [];
	const isPartnerOnly = (id: string) => {
		const p = selected.get(id);
		return (
			!!p &&
			p.role === PERSON_ROLES.PARTNER &&
			(index.parentLinksOfChild.get(id) ?? []).every((l) => !selected.has(l.parentId))
		);
	};
	for (const p of selection.people) {
		if (x.has(`p:${p.id}`) || !index.personById.has(p.id)) continue;
		newcomers.push({
			key: `p:${p.id}`,
			plane: plane(p.id),
			generation: p.generation,
			width: m.cardWidth,
			order: isPartnerOnly(p.id) ? 1 : 0,
			desired: () => estimate(p.id, new Set()) ?? 0
		});
	}
	for (const [key, ghost] of [...ghostWanted].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
		const person = selected.get(ghost.personId)!;
		newcomers.push({
			key: `g:${key}`,
			plane: ghost.plane,
			generation: person.generation,
			width: m.cardWidth,
			order: 0,
			desired: () => estimate(ghost.personId, new Set()) ?? 0
		});
	}
	const placedStubIds = new Set(flat.stubs.map((s) => s.id));
	for (const s of selection.stubs) {
		if (placedStubIds.has(s.id)) continue;
		newcomers.push({
			key: `s:${s.id}`,
			plane: stubPlane(s),
			generation: s.generation,
			width: m.stubWidth,
			order: 2,
			desired: () => {
				const owner = s.unionId ? unionXOf(s.unionId, new Set()) : null;
				return owner ?? estimate(s.personId, new Set()) ?? 0;
			}
		});
	}
	// Top rows first, so what hangs below finds its parents already standing.
	newcomers.sort(
		(a, b) =>
			a.generation - b.generation ||
			a.order - b.order ||
			a.plane - b.plane ||
			(a.key < b.key ? -1 : 1)
	);
	for (const n of newcomers) {
		const row = standing.get(rowKey(n.plane, n.generation)) ?? [];
		const partnerOfPlaced = n.key.startsWith('p:')
			? (index.unionsOfPerson.get(n.key.slice(2)) ?? [])
					.filter((u) => drawnUnionIds.has(u.id))
					.flatMap((u) => u.partnerIds)
					.find((id) => x.has(`p:${id}`))
			: undefined;
		const desired = partnerOfPlaced ? x.get(`p:${partnerOfPlaced}`)! : n.desired();
		const placedAt = nearestFreeX(row, n.key, n.width, desired, partnerPairs, m);
		x.set(n.key, placedAt);
		stand(n.plane, n.generation, { key: n.key, x: placedAt, width: n.width });
		rowOf.set(n.key, { plane: n.plane, generation: n.generation });
	}

	// ---- Keep each side on its side of every row ----
	// Cards trade places among the card-wide slots of their row; stubs stay where they are.
	const sideOfKey = (key: string): number => {
		// Ids can hold any character, `@` included, so a ghost's person is looked up, not parsed out.
		const id = key.startsWith('g:') ? ghostWanted.get(key.slice(2))!.personId : key.slice(2);
		return SIDE_RANK[side(id)];
	};
	const cardKeysByRow = new Map<string, string[]>();
	for (const [key, row] of rowOf) {
		if (key.startsWith('s:')) continue;
		const rk = rowKey(row.plane, row.generation);
		cardKeysByRow.set(rk, [...(cardKeysByRow.get(rk) ?? []), key]);
	}
	for (const keys of cardKeysByRow.values()) {
		const slots = keys.map((k) => x.get(k)!).sort((a, b) => a - b);
		const ordered = [...keys].sort(
			(a, b) => sideOfKey(a) - sideOfKey(b) || x.get(a)! - x.get(b)! || (a < b ? -1 : 1)
		);
		ordered.forEach((key, i) => x.set(key, slots[i]));
	}

	// ---- Placed things ----
	const people: LayerPerson[] = [];
	for (const p of selection.people) {
		const person = index.personById.get(p.id);
		const px = x.get(`p:${p.id}`);
		if (!person || px === undefined) continue;
		people.push({
			id: p.id,
			x: clean(px),
			generation: p.generation,
			plane: plane(p.id),
			band: p.band,
			side: side(p.id),
			role: p.role,
			anchorParentId: p.anchorParentId,
			isStepChild: p.isStepChild,
			person
		});
	}
	const byRow = (a: { plane: Band; generation: number; x: number; id: string }, b: typeof a) =>
		a.plane - b.plane || a.generation - b.generation || a.x - b.x || (a.id < b.id ? -1 : 1);
	people.sort(byRow);
	const personAt = new Map(people.map((p) => [p.id, p]));

	const ghosts: LayerGhost[] = [];
	for (const [key, ghost] of ghostWanted) {
		const person = personAt.get(ghost.personId);
		const gx = x.get(`g:${key}`);
		if (!person || gx === undefined) continue;
		ghosts.push({
			id: `ghost:${key}`,
			personId: ghost.personId,
			plane: ghost.plane,
			generation: person.generation,
			x: clean(gx),
			side: person.side,
			person: person.person
		});
	}
	ghosts.sort((a, b) => byRow(a, b));

	const depthLinks: DepthLink[] = ghosts.map((g) => {
		const real = personAt.get(g.personId)!;
		return {
			id: `depth:${g.personId}@${g.plane}`,
			personId: g.personId,
			from: { plane: g.plane, generation: g.generation, x: g.x },
			to: { plane: real.plane, generation: real.generation, x: real.x }
		};
	});

	const rowCards = new Map<string, Array<{ x: number; id: string }>>();
	for (const p of people) {
		const k = rowKey(p.plane, p.generation);
		rowCards.set(k, [...(rowCards.get(k) ?? []), { x: p.x, id: p.id }]);
	}
	const unions: LayerUnion[] = [];
	for (const u of selection.unions) {
		const union = index.unionById.get(u.id);
		if (!union) continue;
		const onPlane = unionPlanes.get(u.id)!;
		const partners = [...new Set(union.partnerIds)]
			.map((id) => personAt.get(id))
			.filter((p): p is LayerPerson => !!p && p.plane === onPlane && p.generation === u.generation);
		const flatUnion = flat.unions.find((f) => f.id === u.id);
		const ux =
			partners.length > 0
				? partners.reduce((sum, p) => sum + p.x, 0) / partners.length
				: (flatUnion?.x ?? 0);
		const xs = partners.map((p) => p.x).sort((a, b) => a - b);
		// The node sits on the row between exactly two adjacent partners with room for it, else below.
		const isBetween =
			partners.length === 2 &&
			xs[1] - xs[0] - m.cardWidth >= 2 * m.unionRadius + 8 &&
			(rowCards.get(rowKey(onPlane, u.generation)) ?? []).every(
				(c) => c.x <= xs[0] + 1e-6 || c.x >= xs[1] - 1e-6
			);
		unions.push({
			id: u.id,
			x: clean(ux),
			generation: u.generation,
			plane: onPlane,
			isHanging: !isBetween,
			union
		});
	}
	unions.sort((a, b) => byRow(a, b));

	const stubs: LayerStub[] = [];
	for (const s of selection.stubs) {
		const sx = x.get(`s:${s.id}`);
		if (sx === undefined) continue;
		stubs.push({
			id: s.id,
			kind: s.kind,
			personId: s.personId,
			unionId: s.unionId,
			count: s.count,
			x: clean(sx),
			y: s.generation * m.rowHeight,
			generation: s.generation,
			plane: stubPlane(s)
		});
	}
	stubs.sort((a, b) => byRow(a, b));

	// ---- Edges, one plane at a time, so a line never leaves its plane ----
	const hangOffset = m.cardHeight / 2 + m.unionRadius + 4;
	const primary = new Set<string>();
	for (const e of flat.edges) {
		if (e.kind !== 'child' || e.isSecondaryPath) continue;
		primary.add(
			e.unionId ? `${e.unionId}|${e.childId}` : `direct|${e.assertions[0]?.parentId}|${e.childId}`
		);
	}
	const hasPrimary = new Set<string>();
	for (const key of primary) hasPrimary.add(key.split('|').at(-1)!);
	for (const u of selection.unions) {
		for (const childId of new Set(index.unionById.get(u.id)!.children.map((c) => c.childId))) {
			if (hasPrimary.has(childId)) continue;
			hasPrimary.add(childId);
			primary.add(`${u.id}|${childId}`);
		}
	}
	for (const link of directLinks) {
		if (hasPrimary.has(link.childId)) continue;
		hasPrimary.add(link.childId);
		primary.add(`direct|${link.parentId}|${link.childId}`);
	}

	const edges: LayerEdge[] = [];
	const collapsers: LayerCollapser[] = [];
	for (const onPlane of [0, 1, 2] as const) {
		const planePeople = new Map<string, PlacedPerson>();
		const add = (
			id: string,
			px: number,
			generation: number,
			role: PersonRole,
			person: RelationshipGraphPerson
		) => planePeople.set(id, { id, x: px, y: generation * m.rowHeight, generation, role, person });
		for (const p of people) if (p.plane === onPlane) add(p.id, p.x, p.generation, p.role, p.person);
		for (const g of ghosts)
			if (g.plane === onPlane)
				add(g.personId, g.x, g.generation, personAt.get(g.personId)!.role, g.person);
		const planeUnions = new Map<string, PlacedUnion>(
			unions
				.filter((u) => u.plane === onPlane)
				.map((u) => [
					u.id,
					{
						id: u.id,
						x: u.x,
						y: u.generation * m.rowHeight + (u.isHanging ? hangOffset : 0),
						generation: u.generation,
						isHanging: u.isHanging,
						union: u.union
					}
				])
		);
		const planeStubs = stubs.filter((s) => s.plane === onPlane);
		const built = buildEdges(
			index,
			{ ...selection, unions: selection.unions.filter((u) => unionPlanes.get(u.id) === onPlane) },
			planePeople,
			planeUnions,
			planeStubs,
			primary,
			directLinks.filter((l) => plane(l.parentId) === onPlane)
		);
		for (const e of built) edges.push({ ...e, plane: onPlane });

		for (const e of selection.expansions) {
			if (stubPlane(e) !== onPlane) continue;
			const person = planePeople.get(e.personId);
			const union = e.unionId ? planeUnions.get(e.unionId) : undefined;
			const at =
				e.kind === 'ancestors' && person
					? { x: person.x, y: person.y - m.cardHeight / 2 }
					: union
						? { x: union.x, y: union.y + m.unionRadius + 12 }
						: person
							? { x: person.x + m.cardWidth / 2 - 18, y: person.y + m.cardHeight / 2 }
							: null;
			if (at) collapsers.push({ ...e, x: clean(at.x), y: clean(at.y), plane: onPlane });
		}
	}

	const rowsByPlane = new Map<Band, Set<number>>();
	const note = (onPlane: Band, generation: number) => {
		const set = rowsByPlane.get(onPlane) ?? new Set<number>();
		set.add(generation);
		rowsByPlane.set(onPlane, set);
	};
	for (const p of people) note(p.plane, p.generation);
	for (const g of ghosts) note(g.plane, g.generation);
	for (const u of unions) note(u.plane, u.generation);
	for (const s of stubs) note(s.plane, s.generation);
	const planes: LayerPlane[] = [...rowsByPlane.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([onPlane, generations]) => ({
			plane: onPlane,
			generations: [...generations].sort((a, b) => a - b)
		}));

	const xs = [...people.map((p) => p.x), ...ghosts.map((g) => g.x), ...stubs.map((s) => s.x)];
	const gens = planes.flatMap((p) => p.generations);
	return {
		focusPersonId,
		focusUnionId: focusUnion?.id ?? null,
		unionChoices,
		planes,
		people,
		ghosts,
		unions,
		stubs,
		edges,
		depthLinks,
		collapsers,
		collapsedPersonIds: selection.collapsedPersonIds,
		bounds: {
			minX: Math.min(...xs) - m.cardWidth / 2,
			maxX: Math.max(...xs) + m.cardWidth / 2,
			minGeneration: Math.min(...gens),
			maxGeneration: Math.max(...gens)
		}
	};
}
