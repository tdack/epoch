/**
 * The `floors` layout: one horizontal plane per generation, and on each floor one row per band
 * (direct line, sibling line, cousin line). Pure data like `layoutFocusView`; the canvas decides
 * how to draw it.
 *
 * x starts from the flat hourglass so switching view does not reshuffle anyone. Splitting a
 * generation into band rows then leaves holes where other bands' cards used to stand, and those
 * holes are what the compaction closes.
 */

import { buildIndex } from './graph-index.js';
import { layoutFocusView } from './index.js';
import { selectFocusSubgraph } from './select.js';
import {
	LAYOUT_METRICS,
	type Band,
	type ChildAssertion,
	type FocusViewOptions,
	type LayoutMetrics,
	type ParentChildType,
	type PersonRole,
	type PlacedPerson,
	type PlacedStub,
	type PlacedUnion,
	type RelationshipGraph,
	type RelationshipGraphPerson
} from './types.js';

export interface FloorPerson {
	id: string;
	x: number;
	generation: number;
	band: Band;
	role: PersonRole;
	/** The drawn parent this person hangs from, as in every view. */
	anchorParentId: string | null;
	isStepChild: boolean;
	person: RelationshipGraphPerson;
}

interface FloorUnion {
	id: string;
	x: number;
	generation: number;
	/** The lowest band among its drawn partners. */
	band: Band;
	isHanging: boolean;
	union: PlacedUnion['union'];
}

interface FloorStub {
	id: string;
	kind: PlacedStub['kind'];
	personId: string;
	unionId: string | null;
	count: number;
	x: number;
	generation: number;
	band: Band;
}

/** A partner's line to its union, drawn within one floor row. */
interface FloorEdge {
	id: string;
	generation: number;
	band: Band;
	fromX: number;
	toX: number;
	unionId: string;
	personId: string;
}

interface DropEnd {
	generation: number;
	band: Band;
	x: number;
}

/**
 * A parent–child line between floors. It leaves the floor of its union (or of the parent, for a
 * link with no union) and lands on the child's floor, so the canvas draws it as a vertical line
 * in the stage rather than a line on either plane.
 */
interface FloorDrop {
	id: string;
	unionId: string | null;
	parentId: string | null;
	childId: string;
	assertions: ChildAssertion[];
	types: ParentChildType[];
	isSecondaryPath: boolean;
	leaves: DropEnd;
	lands: DropEnd;
}

/** A "+N" stub's dashed line to the person or union it stands in for; it crosses floors. */
interface FloorStubLink {
	id: string;
	stubId: string;
	owner: DropEnd;
	stub: DropEnd;
}

/** The control that collapses an expanded stub, at the card or union it belongs to. */
interface FloorCollapser {
	stubId: string;
	kind: PlacedStub['kind'];
	personId: string;
	unionId: string | null;
	generation: number;
	band: Band;
	x: number;
}

interface Floor {
	generation: number;
	/** Bands that hold something on this floor, ascending. */
	bands: Band[];
}

export interface FloorsLayout {
	focusPersonId: string | null;
	floors: Floor[];
	people: FloorPerson[];
	unions: FloorUnion[];
	stubs: FloorStub[];
	floorEdges: FloorEdge[];
	drops: FloorDrop[];
	stubLinks: FloorStubLink[];
	collapsers: FloorCollapser[];
	collapsedPersonIds: string[];
	misplacedPersonIds: string[];
	bounds: { minX: number; maxX: number; minGeneration: number; maxGeneration: number };
}

const EMPTY_FLOORS: FloorsLayout = {
	focusPersonId: null,
	floors: [],
	people: [],
	unions: [],
	stubs: [],
	floorEdges: [],
	drops: [],
	stubLinks: [],
	collapsers: [],
	collapsedPersonIds: [],
	misplacedPersonIds: [],
	bounds: { minX: 0, maxX: 0, minGeneration: 0, maxGeneration: 0 }
};

interface RowItem {
	key: string;
	x: number;
	width: number;
	generation: number;
	band: Band;
}

function clean(value: number): number {
	const rounded = Math.round(value * 1000) / 1000;
	return rounded === 0 ? 0 : rounded;
}

/**
 * New x for every row item. Walking each (generation, band) row left to right, a gap that held
 * other bands' cards in the flat row shrinks by the width those cards took, never below the
 * spacing flat already uses between neighbours. Gaps that held nothing foreign stay as they were,
 * which keeps children under their parents wherever the bands agree.
 */
function compact(
	items: RowItem[],
	partnerPairs: Set<string>,
	m: LayoutMetrics
): Map<string, number> {
	const moved = new Map<string, number>();
	const byGeneration = new Map<number, RowItem[]>();
	for (const item of items) {
		const list = byGeneration.get(item.generation) ?? [];
		list.push(item);
		byGeneration.set(item.generation, list);
	}
	for (const flatRow of byGeneration.values()) {
		flatRow.sort((a, b) => a.x - b.x || (a.key < b.key ? -1 : 1));
		for (const band of [0, 1, 2] as const) {
			const row = flatRow.filter((i) => i.band === band);
			let shift = 0;
			row.forEach((item, i) => {
				if (i > 0) {
					const prev = row[i - 1];
					const gap = item.x - prev.x;
					const pairKey = [prev.key, item.key].sort().join('|');
					const natural =
						(prev.width + item.width) / 2 +
						(partnerPairs.has(pairKey) ? m.partnerGap : m.siblingGap);
					let foreign = 0;
					for (const other of flatRow) {
						if (other.band !== band && other.x > prev.x && other.x < item.x) {
							foreign += other.width + m.siblingGap;
						}
					}
					const target = Math.max(natural, gap - foreign);
					shift -= Math.max(0, gap - target);
				}
				moved.set(item.key, item.x + shift);
			});
		}
	}
	return moved;
}

/**
 * Lay out the floors around `focusPersonId`. Returns an empty layout when the person is not in
 * the graph.
 */
export function layoutFloors(
	graph: RelationshipGraph,
	focusPersonId: string | null | undefined,
	options: FocusViewOptions = {},
	m: LayoutMetrics = LAYOUT_METRICS
): FloorsLayout {
	if (!focusPersonId) return EMPTY_FLOORS;
	const index = buildIndex(graph);
	const selection = selectFocusSubgraph(graph, focusPersonId, options, index);
	if (!selection) return EMPTY_FLOORS;
	const flat = layoutFocusView(graph, focusPersonId, options, m);

	const selected = new Map(selection.people.map((p) => [p.id, p]));
	const bandOf = (personId: string): Band => selected.get(personId)?.band ?? 0;
	const unionBand = (partnerIds: string[]): Band => {
		const bands = partnerIds.filter((id) => selected.has(id)).map(bandOf);
		return bands.length > 0 ? (Math.min(...bands) as Band) : 0;
	};
	const stubBand = (stub: PlacedStub): Band => {
		const union = stub.unionId ? flat.unions.find((u) => u.id === stub.unionId) : undefined;
		return union ? unionBand(union.union.partnerIds) : bandOf(stub.personId);
	};

	const items: RowItem[] = [
		...flat.people.map((p) => ({
			key: `p:${p.id}`,
			x: p.x,
			width: m.cardWidth,
			generation: p.generation,
			band: bandOf(p.id)
		})),
		...flat.stubs.map((s) => ({
			key: `s:${s.id}`,
			x: s.x,
			width: m.stubWidth,
			generation: s.generation,
			band: stubBand(s)
		}))
	];
	const partnerPairs = new Set<string>();
	for (const u of flat.unions) {
		const ids = u.union.partnerIds.filter((id) => selected.has(id));
		for (let i = 0; i + 1 < ids.length; i++) {
			partnerPairs.add([`p:${ids[i]}`, `p:${ids[i + 1]}`].sort().join('|'));
		}
	}
	const moved = compact(items, partnerPairs, m);

	const people: FloorPerson[] = flat.people.map((p: PlacedPerson) => ({
		id: p.id,
		x: clean(moved.get(`p:${p.id}`) ?? p.x),
		generation: p.generation,
		band: bandOf(p.id),
		role: p.role,
		anchorParentId: selected.get(p.id)?.anchorParentId ?? null,
		isStepChild: selected.get(p.id)?.isStepChild ?? false,
		person: p.person
	}));
	const personAt = new Map(people.map((p) => [p.id, p]));

	// A union sits between its partners on whatever they moved to; its own flat x only matters
	// when none of them is drawn.
	const unions: FloorUnion[] = flat.unions.map((u) => {
		const partners = u.union.partnerIds.map((id) => personAt.get(id)).filter((p) => !!p);
		const x =
			partners.length > 0 ? partners.reduce((sum, p) => sum + p.x, 0) / partners.length : u.x;
		return {
			id: u.id,
			x: clean(x),
			generation: u.generation,
			band: unionBand(u.union.partnerIds),
			isHanging: u.isHanging,
			union: u.union
		};
	});
	const unionAt = new Map(unions.map((u) => [u.id, u]));

	const stubs: FloorStub[] = flat.stubs.map((s) => ({
		id: s.id,
		kind: s.kind,
		personId: s.personId,
		unionId: s.unionId,
		count: s.count,
		x: clean(moved.get(`s:${s.id}`) ?? s.x),
		generation: s.generation,
		band: stubBand(s)
	}));
	const stubAt = new Map(stubs.map((s) => [s.id, s]));

	const floorEdges: FloorEdge[] = [];
	const drops: FloorDrop[] = [];
	const stubLinks: FloorStubLink[] = [];
	/** The union a stub hangs from, else the person. */
	const ownerEnd = (stub: FloorStub): DropEnd | null => {
		const union = stub.unionId ? unionAt.get(stub.unionId) : undefined;
		if (union) return { generation: union.generation, band: union.band, x: union.x };
		const person = personAt.get(stub.personId);
		return person ? { generation: person.generation, band: person.band, x: person.x } : null;
	};
	for (const e of flat.edges) {
		if (e.kind === 'partner') {
			const union = unionAt.get(e.unionId);
			const person = personAt.get(e.personId);
			if (!union || !person) continue;
			floorEdges.push({
				id: e.id,
				generation: person.generation,
				band: person.band,
				fromX: person.x,
				toX: union.x,
				unionId: e.unionId,
				personId: e.personId
			});
		} else if (e.kind === 'stub') {
			const stub = stubAt.get(e.stubId);
			const owner = stub && ownerEnd(stub);
			if (stub && owner) {
				stubLinks.push({
					id: e.id,
					stubId: stub.id,
					owner,
					stub: { generation: stub.generation, band: stub.band, x: stub.x }
				});
			}
		} else {
			const child = personAt.get(e.childId);
			if (!child) continue;
			let leaves: DropEnd | null = null;
			let parentId: string | null = null;
			if (e.unionId) {
				const union = unionAt.get(e.unionId);
				if (union) leaves = { generation: union.generation, band: union.band, x: union.x };
			} else {
				// A link with no union leaves its parent card; the flat source point says which one.
				const parents = e.assertions
					.map((a) => personAt.get(a.parentId))
					.filter((p) => !!p)
					.sort((a, b) => a.id.localeCompare(b.id));
				const parent = parents.find((p) => Math.abs(p.x - e.source.x) < 1e-6) ?? parents[0];
				if (parent) {
					parentId = parent.id;
					leaves = { generation: parent.generation, band: parent.band, x: parent.x };
				}
			}
			if (!leaves) continue;
			drops.push({
				id: e.id,
				unionId: e.unionId,
				parentId,
				childId: e.childId,
				assertions: e.assertions,
				types: e.types,
				isSecondaryPath: e.isSecondaryPath,
				leaves,
				lands: { generation: child.generation, band: child.band, x: child.x }
			});
		}
	}

	const collapsers: FloorCollapser[] = [];
	for (const c of flat.collapsers) {
		const person = personAt.get(c.personId);
		const union = c.unionId ? unionAt.get(c.unionId) : undefined;
		const at =
			c.kind === 'ancestors' || !union
				? person && { generation: person.generation, band: person.band, x: person.x }
				: { generation: union.generation, band: union.band, x: union.x };
		if (at) collapsers.push({ ...c, ...at });
	}

	const bandsByGeneration = new Map<number, Set<Band>>();
	const note = (generation: number, band: Band) => {
		const set = bandsByGeneration.get(generation) ?? new Set<Band>();
		set.add(band);
		bandsByGeneration.set(generation, set);
	};
	for (const p of people) note(p.generation, p.band);
	for (const u of unions) note(u.generation, u.band);
	for (const s of stubs) note(s.generation, s.band);
	const floors: Floor[] = [...bandsByGeneration.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([generation, bands]) => ({ generation, bands: [...bands].sort() as Band[] }));

	const xs = [...people.map((p) => p.x), ...stubs.map((s) => s.x)];
	const gens = floors.map((f) => f.generation);
	return {
		focusPersonId,
		floors,
		people,
		unions,
		stubs,
		floorEdges,
		drops,
		stubLinks,
		collapsers,
		collapsedPersonIds: flat.collapsedPersonIds,
		misplacedPersonIds: flat.misplacedPersonIds,
		bounds: {
			minX: Math.min(...xs) - m.cardWidth / 2,
			maxX: Math.max(...xs) + m.cardWidth / 2,
			minGeneration: Math.min(...gens),
			maxGeneration: Math.max(...gens)
		}
	};
}
