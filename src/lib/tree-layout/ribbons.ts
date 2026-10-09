/**
 * The Ribbons view (ADR-032): lineages as tubes that flow from the oldest generation at the top to
 * the youngest at the bottom. Each person is one ribbon that enters from the union their parents
 * hold (or from above, with no drawn parents) and runs on to a knot for each union they are a
 * partner in. A union's partners' ribbons meet at its knot and the children's ribbons leave it.
 * Pure: the WebGL scene turns these strands into tubes, so everything here is testable without
 * a browser.
 *
 * The same selection feeds every view (`selectFocusSubgraph`), so Ribbons draws exactly who Flat
 * would for the same address. A union is never taken to be a marriage, and its partners are drawn
 * in `union_partner` order whatever their sex.
 */

import { buildIndex, type GraphIndex } from './graph-index.js';
import { linkKey } from './highlight.js';
import { selectFocusSubgraph } from './select.js';
import type {
	Band,
	FocusViewOptions,
	ParentChildType,
	RelationshipGraph,
	RelationshipGraphPerson,
	TreeSelection
} from './types.js';

/** Distance between neighbours in a row across the flow, and between generations along it. */
const RIBBON_SLOT_UNITS = 2.6;
const RIBBON_ROW_UNITS = 8;
/** How far below its lowest partner a union's knot hangs, so the children's lines have room to fan. */
const RIBBON_KNOT_DROP_UNITS = 2.6;
/** The length of the ribbon above a person with no drawn parents. */
const RIBBON_ENTRY_STUB_UNITS = 3.2;
/** Depth (z) between siblings' households, and the spread of households with no drawn parents. */
const LANE_UNITS = 2.4;
const ROOT_LANE_UNITS = 5;
/** Passes of the barycentre sweep (each is a pass down then a pass up); the best layout is kept. */
const SWEEP_COUNT = 5;
/** Cap on the pairwise push that keeps neighbours apart; it settles long before this. */
const SEPARATE_SWEEP_LIMIT = 300;

/** Which direction a person's ribbon runs, from the strand's point of view. */
export const RIBBON_STRAND_KINDS = {
	/** The person's one entry: from their parents' union knot, a lone parent, or from above. */
	ENTRY: 'entry',
	/** A further parent link of the same person, drawn thin so converging lines still show. */
	EXTRA_ENTRY: 'extraEntry',
	/** From the person to a knot of a union they are a partner in. */
	JOIN: 'join'
} as const;
type RibbonStrandKind = (typeof RIBBON_STRAND_KINDS)[keyof typeof RIBBON_STRAND_KINDS];

interface Vec3 {
	x: number;
	y: number;
	z: number;
}

interface RibbonsPerson extends Vec3 {
	id: string;
	/** Rows relative to the focus: negative above, positive below. */
	generation: number;
	band: Band;
	person: RelationshipGraphPerson;
}

/** A union's knot: where its partners' ribbons meet and its children's leave. */
interface RibbonsUnion extends Vec3 {
	id: string;
	/** The row of the youngest drawn partner. */
	generation: number;
	/** Drawn partners in `union_partner` order. */
	partnerIds: string[];
}

/** A parent-child line, as on Rings: it leaves the union when the child is asserted within a drawn one. */
interface RibbonsChildLink {
	childId: string;
	fromUnionId: string | null;
	/** Set when `fromUnionId` is null. */
	fromPersonId: string | null;
	type: ParentChildType;
	parentIds: string[];
}

export interface RibbonStrand {
	id: string;
	/** Whose ribbon this is. */
	personId: string;
	kind: RibbonStrandKind;
	/** The union whose knot this strand starts at (entry) or ends at (join); null for a lone parent or a stub. */
	unionId: string | null;
	/** The parent this strand starts at when it leaves a person rather than a knot. */
	fromPersonId: string | null;
	/** True for an entry from above with no drawn parent: a short stub, not a link. */
	isStub: boolean;
	/**
	 * The `linkKey` of the parent-child line an entry or extra entry draws; null for a stub or a
	 * join. It is how the scene finds a tube's mark and its pick proxy.
	 */
	linkKey: string | null;
	from: Vec3;
	to: Vec3;
	/** For a join: this person's place among the union's partners, which sets the braid's phase. */
	braidIndex: number;
	braidCount: number;
}

export interface RibbonsLayout {
	/** Null when the whole tree is drawn; nobody is then the focus. */
	focusPersonId: string | null;
	people: RibbonsPerson[];
	unions: RibbonsUnion[];
	childLinks: RibbonsChildLink[];
	strands: RibbonStrand[];
	/** People reached by more than one path; drawn once, with converging lines. */
	collapsedPersonIds: string[];
}

const EMPTY_RIBBONS_LAYOUT: RibbonsLayout = {
	focusPersonId: null,
	people: [],
	unions: [],
	childLinks: [],
	strands: [],
	collapsedPersonIds: []
};

/**
 * `sweep` orders each row by repeated barycentre passes and keeps the best; `input` keeps the
 * selection's own order, the baseline the crossing test compares against.
 */
export type RibbonsOrdering = 'sweep' | 'input';

/** A small stable hash in [0, 1) so root households spread without randomness. */
function hash01(text: string): number {
	let h = 2166136261;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return ((h >>> 0) % 100003) / 100003;
}

/**
 * Households on one row: people joined by drawn unions on that row, as a chain so someone with two
 * partners stands between them. Keeps the selection's order between equals.
 */
function households(
	members: string[],
	generationOf: Map<string, number>,
	partnersOf: Map<string, string[]>
): string[][] {
	const seen = new Set<string>();
	const result: string[][] = [];
	const order = new Map(members.map((id, i) => [id, i]));
	for (const start of members) {
		if (seen.has(start)) continue;
		const generation = generationOf.get(start)!;
		const component: string[] = [];
		const stack = [start];
		while (stack.length > 0) {
			const id = stack.pop()!;
			if (seen.has(id)) continue;
			seen.add(id);
			component.push(id);
			for (const other of partnersOf.get(id) ?? [])
				if (!seen.has(other) && generationOf.get(other) === generation) stack.push(other);
		}
		const degree = (id: string) =>
			(partnersOf.get(id) ?? []).filter((o) => component.includes(o)).length;
		const byEnd = [...component].sort(
			(a, b) => degree(a) - degree(b) || order.get(a)! - order.get(b)!
		);
		const chain: string[] = [];
		let current: string | undefined = byEnd[0];
		while (current !== undefined && !chain.includes(current)) {
			chain.push(current);
			current = (partnersOf.get(current) ?? []).find(
				(o) => component.includes(o) && !chain.includes(o)
			);
		}
		for (const id of byEnd) if (!chain.includes(id)) chain.push(id);
		result.push(chain);
	}
	return result;
}

interface Slot {
	house: string[];
	want: number | null;
	at: number;
	span: number;
}

/** Pushes neighbours apart in their fixed order until none overlap, each staying near its want. */
function separate(slots: Slot[]): void {
	for (let sweep = 0; sweep < SEPARATE_SWEEP_LIMIT; sweep++) {
		let didMove = false;
		for (let i = 0; i + 1 < slots.length; i++) {
			const a = slots[i];
			const b = slots[i + 1];
			const need = (a.span + b.span) / 2;
			const gap = b.at - a.at;
			if (gap < need - 1e-9) {
				const push = (need - gap) / 2;
				a.at -= push;
				b.at += push;
				didMove = true;
			}
		}
		if (!didMove) return;
	}
}

/** Gives every slot without a want a place just right of its neighbour (or left of the next known). */
function fillWants(slots: Slot[]): void {
	const firstKnown = slots.findIndex((s) => s.want !== null);
	if (firstKnown < 0) {
		let cursor = 0;
		for (const s of slots) {
			s.want = cursor + s.span / 2;
			cursor += s.span;
		}
		return;
	}
	for (let i = firstKnown - 1; i >= 0; i--)
		slots[i].want = slots[i + 1].want! - (slots[i].span + slots[i + 1].span) / 2;
	for (let i = firstKnown + 1; i < slots.length; i++)
		if (slots[i].want === null)
			slots[i].want = slots[i - 1].want! + (slots[i].span + slots[i - 1].span) / 2;
}

interface Placed {
	people: Map<string, Vec3>;
	unions: Map<string, Vec3>;
}

/**
 * Pairs of strands between the same two levels whose ends are in opposite orders across the flow.
 * Strands that share a start or an end do not cross there.
 */
export function countRibbonCrossings(layout: RibbonsLayout): number {
	const levelOfPerson = new Map(layout.people.map((p) => [p.id, 2 * p.generation]));
	const levelOfUnion = new Map(layout.unions.map((u) => [u.id, 2 * u.generation + 1]));
	const buckets = new Map<string, Array<[number, number]>>();
	for (const s of layout.strands) {
		if (s.isStub) continue;
		const own = levelOfPerson.get(s.personId)!;
		const other =
			s.unionId !== null
				? levelOfUnion.get(s.unionId)
				: s.fromPersonId !== null
					? levelOfPerson.get(s.fromPersonId)
					: undefined;
		if (other === undefined) continue;
		const top = s.kind === RIBBON_STRAND_KINDS.JOIN ? own : other;
		const bottom = s.kind === RIBBON_STRAND_KINDS.JOIN ? other : own;
		const key = `${top}:${bottom}`;
		const list = buckets.get(key) ?? [];
		list.push([s.from.x, s.to.x]);
		buckets.set(key, list);
	}
	let crossings = 0;
	for (const list of buckets.values())
		for (let i = 0; i < list.length; i++)
			for (let j = i + 1; j < list.length; j++)
				if ((list[i][0] - list[j][0]) * (list[i][1] - list[j][1]) < 0) crossings++;
	return crossings;
}

/**
 * Lay out Ribbons around `focusPersonId`. Returns the empty layout when the person is not in the
 * graph.
 */
export function layoutRibbons(
	graph: RelationshipGraph,
	focusPersonId: string | null | undefined,
	options: FocusViewOptions = {},
	index: GraphIndex = buildIndex(graph),
	ordering: RibbonsOrdering = 'sweep',
	given?: TreeSelection
): RibbonsLayout {
	if (!given && !focusPersonId) return EMPTY_RIBBONS_LAYOUT;
	const selection = given ?? selectFocusSubgraph(graph, focusPersonId!, options, index);
	if (!selection) return EMPTY_RIBBONS_LAYOUT;

	const generationOf = new Map(selection.people.map((p) => [p.id, p.generation]));
	const isDrawn = (id: string) => generationOf.has(id);
	const drawnUnions = selection.unions
		.map((u) => index.unionById.get(u.id)!)
		.filter((u) => u.partnerIds.some(isDrawn));
	const partnersOfUnion = new Map(drawnUnions.map((u) => [u.id, u.partnerIds.filter(isDrawn)]));
	const knotGenerationOf = new Map(
		drawnUnions.map((u) => [
			u.id,
			Math.max(...partnersOfUnion.get(u.id)!.map((id) => generationOf.get(id)!))
		])
	);
	const unionsOfPerson = new Map<string, string[]>();
	const partnersOf = new Map<string, string[]>();
	for (const u of drawnUnions) {
		const partners = partnersOfUnion.get(u.id)!;
		for (const id of partners) {
			unionsOfPerson.set(id, [...(unionsOfPerson.get(id) ?? []), u.id]);
			partnersOf.set(id, [
				...(partnersOf.get(id) ?? []),
				...partners.filter((o) => o !== id && !partnersOf.get(id)?.includes(o))
			]);
		}
	}

	// Which union (or lone parent) each child's lines leave from; the first is the person's entry.
	const drawnUnionIds = new Set(drawnUnions.map((u) => u.id));
	const childLinks: RibbonsChildLink[] = [];
	const linksOfChild = new Map<string, RibbonsChildLink[]>();
	for (const child of selection.people) {
		const byKey = new Map<string, RibbonsChildLink>();
		for (const link of index.parentLinksOfChild.get(child.id) ?? []) {
			if (!isDrawn(link.parentId)) continue;
			const union = link.unionId !== null ? index.unionById.get(link.unionId) : undefined;
			const isUnionLine =
				union !== undefined &&
				drawnUnionIds.has(union.id) &&
				union.partnerIds.includes(link.parentId);
			const key = isUnionLine ? `u:${union.id}` : `p:${link.parentId}`;
			const existing = byKey.get(key);
			if (existing) {
				if (!existing.parentIds.includes(link.parentId)) existing.parentIds.push(link.parentId);
				continue;
			}
			const line: RibbonsChildLink = {
				childId: child.id,
				fromUnionId: isUnionLine ? union.id : null,
				fromPersonId: isUnionLine ? null : link.parentId,
				type: link.type,
				parentIds: [link.parentId]
			};
			byKey.set(key, line);
			childLinks.push(line);
			linksOfChild.set(child.id, [...(linksOfChild.get(child.id) ?? []), line]);
		}
	}
	/** Children whose lines leave each union's knot or a person directly. */
	const childrenOfSource = new Map<string, string[]>();
	for (const line of childLinks) {
		const key = line.fromUnionId !== null ? `u:${line.fromUnionId}` : `p:${line.fromPersonId}`;
		childrenOfSource.set(key, [...(childrenOfSource.get(key) ?? []), line.childId]);
	}
	const sourceKey = (line: RibbonsChildLink) =>
		line.fromUnionId !== null ? `u:${line.fromUnionId}` : `p:${line.fromPersonId}`;

	const generations = [...new Set(selection.people.map((p) => p.generation))].sort((a, b) => a - b);
	const membersOf = (g: number) =>
		selection.people.filter((p) => p.generation === g).map((p) => p.id);
	const initialOrder = new Map<number, string[][]>(
		generations.map((g) => [g, households(membersOf(g), generationOf, partnersOf)])
	);

	/** Top-down placement of every row for a given order of households. */
	function place(order: Map<number, string[][]>): Placed {
		const people = new Map<string, Vec3>();
		const unions = new Map<string, Vec3>();
		const sourcePosition = (line: RibbonsChildLink): Vec3 | undefined =>
			line.fromUnionId !== null ? unions.get(line.fromUnionId) : people.get(line.fromPersonId!);
		for (const g of generations) {
			const houses = order.get(g)!;
			const slots: Slot[] = houses.map((house) => {
				const sources = house.flatMap((id) => (linksOfChild.get(id) ?? []).map(sourcePosition));
				const known = sources.filter((s): s is Vec3 => s !== undefined);
				return {
					house,
					want: known.length > 0 ? known.reduce((sum, s) => sum + s.x, 0) / known.length : null,
					at: 0,
					span: house.length * RIBBON_SLOT_UNITS
				};
			});
			fillWants(slots);
			for (const s of slots) s.at = s.want!;
			separate(slots);

			// Depth: a household stays in its parents' lane, and siblings fan across lanes.
			const siblingsSeen = new Map<string, number>();
			const siblingTotal = new Map<string, number>();
			const keyOfHouse = slots.map((s) => {
				const line = s.house.flatMap((id) => linksOfChild.get(id) ?? [])[0];
				return line && sourcePosition(line) ? sourceKey(line) : null;
			});
			for (const key of keyOfHouse)
				if (key !== null) siblingTotal.set(key, (siblingTotal.get(key) ?? 0) + 1);
			slots.forEach((s, i) => {
				const line = s.house.flatMap((id) => linksOfChild.get(id) ?? [])[0];
				const source = line ? sourcePosition(line) : undefined;
				const key = keyOfHouse[i];
				let z: number;
				if (source && key !== null) {
					const k = siblingsSeen.get(key) ?? 0;
					siblingsSeen.set(key, k + 1);
					z = source.z + (k - (siblingTotal.get(key)! - 1) / 2) * LANE_UNITS;
				} else {
					z = (hash01(s.house[0]) * 2 - 1) * ROOT_LANE_UNITS;
				}
				s.house.forEach((id, k) =>
					people.set(id, {
						x: s.at - s.span / 2 + RIBBON_SLOT_UNITS * (k + 0.5),
						y: -g * RIBBON_ROW_UNITS,
						z
					})
				);
			});
			for (const u of drawnUnions) {
				if (knotGenerationOf.get(u.id) !== g) continue;
				const partners = partnersOfUnion.get(u.id)!.map((id) => people.get(id)!);
				unions.set(u.id, {
					x: partners.reduce((sum, p) => sum + p.x, 0) / partners.length,
					y: -g * RIBBON_ROW_UNITS - RIBBON_KNOT_DROP_UNITS,
					z: partners.reduce((sum, p) => sum + p.z, 0) / partners.length
				});
			}
		}
		return { people, unions };
	}

	function build(placed: Placed): RibbonsLayout {
		const people: RibbonsPerson[] = selection!.people.map((p) => ({
			id: p.id,
			generation: p.generation,
			band: p.band,
			...placed.people.get(p.id)!,
			person: index.personById.get(p.id)!
		}));
		const unions: RibbonsUnion[] = drawnUnions.map((u) => ({
			id: u.id,
			generation: knotGenerationOf.get(u.id)!,
			...placed.unions.get(u.id)!,
			partnerIds: partnersOfUnion.get(u.id)!
		}));
		const strands: RibbonStrand[] = [];
		for (const p of selection!.people) {
			const to = placed.people.get(p.id)!;
			const links = (linksOfChild.get(p.id) ?? []).filter(
				(line) =>
					(line.fromUnionId !== null
						? placed.unions.get(line.fromUnionId)
						: placed.people.get(line.fromPersonId!)) !== undefined
			);
			// A union line is preferred as the entry; the rest are extra, thin, converging lines.
			const sorted = [
				...links.filter((l) => l.fromUnionId !== null),
				...links.filter((l) => l.fromUnionId === null)
			];
			if (sorted.length === 0)
				strands.push({
					id: `${p.id}:entry`,
					personId: p.id,
					kind: RIBBON_STRAND_KINDS.ENTRY,
					unionId: null,
					fromPersonId: null,
					isStub: true,
					linkKey: null,
					from: { x: to.x, y: to.y + RIBBON_ENTRY_STUB_UNITS, z: to.z },
					to,
					braidIndex: 0,
					braidCount: 1
				});
			sorted.forEach((line, i) =>
				strands.push({
					id: `${p.id}:${i === 0 ? 'entry' : 'extra'}:${sourceKey(line)}`,
					personId: p.id,
					kind: i === 0 ? RIBBON_STRAND_KINDS.ENTRY : RIBBON_STRAND_KINDS.EXTRA_ENTRY,
					unionId: line.fromUnionId,
					fromPersonId: line.fromPersonId,
					isStub: false,
					linkKey: linkKey(line),
					from:
						line.fromUnionId !== null
							? placed.unions.get(line.fromUnionId)!
							: placed.people.get(line.fromPersonId!)!,
					to,
					braidIndex: 0,
					braidCount: 1
				})
			);
			for (const unionId of unionsOfPerson.get(p.id) ?? []) {
				const partners = partnersOfUnion.get(unionId)!;
				strands.push({
					id: `${p.id}:join:${unionId}`,
					personId: p.id,
					kind: RIBBON_STRAND_KINDS.JOIN,
					unionId,
					fromPersonId: null,
					isStub: false,
					linkKey: null,
					from: to,
					to: placed.unions.get(unionId)!,
					braidIndex: partners.indexOf(p.id),
					braidCount: partners.length
				});
			}
		}
		return {
			focusPersonId: selection!.focusPersonId,
			people,
			unions,
			childLinks,
			strands,
			collapsedPersonIds: selection!.collapsedPersonIds
		};
	}

	let best = build(place(initialOrder));
	if (ordering === 'input' || generations.length < 2) return best;

	// Barycentre sweeps on rank positions; each candidate is placed and counted, and the best kept,
	// so the result is never worse than the selection's own order.
	let bestCrossings = countRibbonCrossings(best);
	let order = new Map(initialOrder);
	const rankX = (o: Map<number, string[][]>) => {
		const x = new Map<string, number>();
		for (const houses of o.values()) {
			const flat = houses.flat();
			flat.forEach((id, i) => x.set(id, i - (flat.length - 1) / 2));
		}
		return x;
	};
	const barycentre = (house: string[], neighbours: (id: string) => number[]): number | null => {
		const values = house.flatMap(neighbours);
		return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
	};
	for (let pass = 0; pass < SWEEP_COUNT; pass++) {
		for (const isDown of [true, false]) {
			const layers = isDown ? generations.slice(1) : generations.slice(0, -1).reverse();
			for (const g of layers) {
				const x = rankX(order);
				const parentsX = (id: string) =>
					(linksOfChild.get(id) ?? []).flatMap((line) => {
						const ids =
							line.fromUnionId !== null
								? partnersOfUnion.get(line.fromUnionId)!
								: [line.fromPersonId!];
						const xs = ids.map((o) => x.get(o)).filter((v): v is number => v !== undefined);
						return xs.length > 0 ? [xs.reduce((a, b) => a + b, 0) / xs.length] : [];
					});
				const childrenX = (id: string) =>
					[
						...(unionsOfPerson.get(id) ?? []).flatMap((u) => childrenOfSource.get(`u:${u}`) ?? []),
						...(childrenOfSource.get(`p:${id}`) ?? [])
					]
						.map((c) => x.get(c))
						.filter((v): v is number => v !== undefined);
				const houses = order.get(g)!;
				const keyed = houses.map((house, i) => ({
					house,
					i,
					key: barycentre(house, isDown ? parentsX : childrenX)
				}));
				// A household with nothing to hang from keeps its place among the others.
				const positioned = keyed.map((k) => k.key ?? x.get(k.house[0])!);
				keyed.forEach((k, i) => (k.key = positioned[i]));
				keyed.sort((a, b) => a.key! - b.key! || a.i - b.i);
				order = new Map(order).set(
					g,
					keyed.map((k) => k.house)
				);
			}
			const candidate = build(place(order));
			const crossings = countRibbonCrossings(candidate);
			if (crossings < bestCrossings) {
				best = candidate;
				bestCrossings = crossings;
			}
		}
	}
	return best;
}
