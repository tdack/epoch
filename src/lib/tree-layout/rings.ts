/**
 * The rings overview (ADR-032): each generation of the focus selection is a horizontal ring, the
 * oldest at the top, and each person stands once on their ring at an angle. Lines run from a
 * partnership down to its children on the ring below. Pure: the WebGL canvas turns angles and
 * radii into 3D positions, so everything here can be tested without a browser.
 *
 * The same selection feeds every view (`selectFocusSubgraph`), so Rings draws exactly who Flat or
 * Layers would for the same address, with no new fetch rules or privacy surface.
 */

import { buildIndex, type GraphIndex } from './graph-index.js';
import { selectFocusSubgraph } from './select.js';
import type {
	Band,
	FocusViewOptions,
	ParentChildType,
	RelationshipGraph,
	RelationshipGraphPerson
} from './types.js';

/** Arc length one person takes on a ring, in scene units; a ring's radius grows to fit its people. */
export const RING_SLOT_UNITS = 1.7;
/** The smallest ring, so a lone couple still reads as a ring and not a point. */
export const RING_MIN_RADIUS_UNITS = 2.6;

const TAU = Math.PI * 2;

interface RingPerson {
	id: string;
	/** Rows relative to the focus: negative above, positive below. */
	generation: number;
	band: Band;
	/** Radians in [0, 2π). */
	angle: number;
	radius: number;
	person: RelationshipGraphPerson;
}

interface RingUnion {
	id: string;
	generation: number;
	/** Radians in [0, 2π): between its drawn partners, where the children's lines leave. */
	angle: number;
	radius: number;
	/** Drawn partners in `union_partner` order. */
	partnerIds: string[];
}

/**
 * A parent-child line. It leaves the union when the child is asserted within a drawn one, else the
 * parent's own sphere (a direct link, or a union whose partners are not drawn together).
 */
interface RingChildLink {
	childId: string;
	fromUnionId: string | null;
	/** Set when `fromUnionId` is null. */
	fromPersonId: string | null;
	/** The first assertion's type; a mixed union line is drawn in its first parent's type. */
	type: ParentChildType;
	/** The drawn parents this line stands for, so a lineage walk can follow it. */
	parentIds: string[];
}

interface Ring {
	generation: number;
	radius: number;
	count: number;
}

export interface RingsLayout {
	focusPersonId: string;
	rings: Ring[];
	people: RingPerson[];
	unions: RingUnion[];
	childLinks: RingChildLink[];
	/** People reached by more than one path; on the rings they are drawn once with converging lines. */
	collapsedPersonIds: string[];
}

const EMPTY_RINGS_LAYOUT: RingsLayout = {
	focusPersonId: '',
	rings: [],
	people: [],
	unions: [],
	childLinks: [],
	collapsedPersonIds: []
};

function wrap(angle: number): number {
	const wrapped = ((angle % TAU) + TAU) % TAU;
	// Rounded so identical inputs serialise identically; 2π itself folds back to 0.
	const rounded = Math.round(wrapped * 1e6) / 1e6;
	return rounded >= Math.round(TAU * 1e6) / 1e6 ? 0 : rounded;
}

/** Null when the angles cancel out (two people exactly opposite), so the caller picks a fallback. */
export function circularMean(angles: number[]): number | null {
	let sin = 0;
	let cos = 0;
	for (const a of angles) {
		sin += Math.sin(a);
		cos += Math.cos(a);
	}
	return Math.abs(sin) + Math.abs(cos) < 1e-9 ? null : wrap(Math.atan2(sin, cos));
}

/**
 * Households on one ring: people joined by drawn partnerships on that ring, as a chain so someone
 * with two partners stands between them. A household is the unit that gets an arc.
 */
function households(
	members: string[],
	generationOf: Map<string, number>,
	partnersOf: Map<string, string[]>
): string[][] {
	const seen = new Set<string>();
	const result: string[][] = [];
	const onRing = (id: string, generation: number) => generationOf.get(id) === generation;
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
				if (!seen.has(other) && onRing(other, generation)) stack.push(other);
		}
		// Walk the chain from an end (the member with fewest partners on this ring), keeping the
		// selection's order between equals so the result is deterministic.
		const order = new Map(members.map((id, i) => [id, i]));
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
		// A partnership triangle cannot be a chain; whoever is left joins the end.
		for (const id of byEnd) if (!chain.includes(id)) chain.push(id);
		result.push(chain);
	}
	return result;
}

interface Arc {
	members: string[];
	want: number;
	at: number;
	span: number;
}

/**
 * Pushes neighbouring arcs apart until none overlap, keeping each as close to where it wants to be
 * as the others allow. The ring's radius already fits everyone, so this always settles; the sweep
 * cap only guards against float dust.
 */
function separate(arcs: Arc[]): void {
	if (arcs.length < 2) return;
	for (let sweep = 0; sweep < 200; sweep++) {
		let didMove = false;
		for (let i = 0; i < arcs.length; i++) {
			const a = arcs[i];
			const b = arcs[(i + 1) % arcs.length];
			const gap = b.at - a.at + (i === arcs.length - 1 ? TAU : 0);
			const need = (a.span + b.span) / 2;
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

/**
 * Lay out the rings around `focusPersonId`. Returns the empty layout when the person is not in the
 * graph.
 */
export function layoutRings(
	graph: RelationshipGraph,
	focusPersonId: string | null | undefined,
	options: FocusViewOptions = {},
	index: GraphIndex = buildIndex(graph)
): RingsLayout {
	if (!focusPersonId) return EMPTY_RINGS_LAYOUT;
	const selection = selectFocusSubgraph(graph, focusPersonId, options, index);
	if (!selection) return EMPTY_RINGS_LAYOUT;

	const generationOf = new Map(selection.people.map((p) => [p.id, p.generation]));
	const isDrawn = (id: string) => generationOf.has(id);
	const drawnUnions = selection.unions
		.map((u) => index.unionById.get(u.id)!)
		.filter((u) => u.partnerIds.some(isDrawn));

	const partnersOf = new Map<string, string[]>();
	for (const u of drawnUnions) {
		const partners = u.partnerIds.filter(isDrawn);
		for (const id of partners)
			partnersOf.set(id, [
				...(partnersOf.get(id) ?? []),
				...partners.filter((o) => o !== id && !partnersOf.get(id)?.includes(o))
			]);
	}

	// Which union (or lone parent) each child's line leaves from.
	const drawnUnionIds = new Set(drawnUnions.map((u) => u.id));
	const childLinks: RingChildLink[] = [];
	for (const child of selection.people) {
		const byUnion = new Map<string, RingChildLink>();
		for (const link of index.parentLinksOfChild.get(child.id) ?? []) {
			if (!isDrawn(link.parentId)) continue;
			const union = link.unionId !== null ? index.unionById.get(link.unionId) : undefined;
			const isUnionLine =
				union !== undefined &&
				drawnUnionIds.has(union.id) &&
				union.partnerIds.includes(link.parentId);
			const key = isUnionLine ? `u:${union.id}` : `p:${link.parentId}`;
			const existing = byUnion.get(key);
			if (existing) {
				if (!existing.parentIds.includes(link.parentId)) existing.parentIds.push(link.parentId);
				continue;
			}
			const line: RingChildLink = {
				childId: child.id,
				fromUnionId: isUnionLine ? union.id : null,
				fromPersonId: isUnionLine ? null : link.parentId,
				type: link.type,
				parentIds: [link.parentId]
			};
			byUnion.set(key, line);
			childLinks.push(line);
		}
	}
	const parentAnchorsOf = new Map<string, RingChildLink[]>();
	for (const line of childLinks)
		parentAnchorsOf.set(line.childId, [...(parentAnchorsOf.get(line.childId) ?? []), line]);

	const generations = [...new Set(selection.people.map((p) => p.generation))].sort((a, b) => a - b);
	const angleOf = new Map<string, number>();
	const radiusOfGeneration = new Map<number, number>();
	const unionAngle = new Map<string, number>();
	const rings: Ring[] = [];

	const placeUnionsOn = (generation: number) => {
		for (const u of drawnUnions) {
			const partners = u.partnerIds.filter(isDrawn);
			if (generationOf.get(partners[0]) !== generation) continue;
			const angles = partners.filter((id) => angleOf.has(id)).map((id) => angleOf.get(id)!);
			const angle = circularMean(angles) ?? angles[0];
			if (angle !== undefined) unionAngle.set(u.id, angle);
		}
	};

	// Top down: each household stands under the partnerships its members came from, so lines drop
	// rather than wrap round the trunk.
	for (const generation of generations) {
		const members = selection.people.filter((p) => p.generation === generation).map((p) => p.id);
		const houses = households(members, generationOf, partnersOf);
		const radius = Math.max(RING_MIN_RADIUS_UNITS, (members.length * RING_SLOT_UNITS) / TAU);
		const slot = Math.min(RING_SLOT_UNITS / radius, TAU / members.length);
		const arcs: Arc[] = houses.map((house, i) => {
			const parentAngles = house.flatMap((id) =>
				(parentAnchorsOf.get(id) ?? [])
					.map((line) =>
						line.fromUnionId !== null
							? unionAngle.get(line.fromUnionId)
							: angleOf.get(line.fromPersonId!)
					)
					.filter((a): a is number => a !== undefined)
			);
			const want = circularMean(parentAngles) ?? (i / houses.length) * TAU;
			return { members: house, want, at: want, span: house.length * slot };
		});
		// Equal wants keep the selection's order, which the sort preserves.
		arcs.sort((a, b) => a.want - b.want);
		separate(arcs);
		for (const arc of arcs)
			arc.members.forEach((id, k) =>
				angleOf.set(id, wrap(arc.at - arc.span / 2 + slot * (k + 0.5)))
			);
		radiusOfGeneration.set(generation, radius);
		rings.push({ generation, radius, count: members.length });
		placeUnionsOn(generation);
	}

	const people: RingPerson[] = selection.people.map((p) => ({
		id: p.id,
		generation: p.generation,
		band: p.band,
		angle: angleOf.get(p.id)!,
		radius: radiusOfGeneration.get(p.generation)!,
		person: index.personById.get(p.id)!
	}));
	const unions: RingUnion[] = drawnUnions
		.filter((u) => unionAngle.has(u.id))
		.map((u) => {
			const partnerIds = u.partnerIds.filter(isDrawn);
			const generation = generationOf.get(partnerIds[0])!;
			return {
				id: u.id,
				generation,
				angle: unionAngle.get(u.id)!,
				radius: radiusOfGeneration.get(generation)!,
				partnerIds
			};
		});
	const placedUnionIds = new Set(unions.map((u) => u.id));

	return {
		focusPersonId,
		rings,
		people,
		unions,
		childLinks: childLinks.filter(
			(line) => line.fromUnionId === null || placedUnionIds.has(line.fromUnionId)
		),
		collapsedPersonIds: selection.collapsedPersonIds
	};
}

/**
 * The focus person's own line on the rings: everyone they descend from, everyone descended from
 * them, and their partners. The canvas lights these and names them; everyone else stays quiet.
 */
export function ringLineage(
	layout: RingsLayout,
	personId: string
): { ancestorIds: Set<string>; descendantIds: Set<string>; partnerIds: Set<string> } {
	const parentsOf = new Map<string, string[]>();
	const childrenOf = new Map<string, string[]>();
	for (const line of layout.childLinks)
		for (const parentId of line.parentIds) {
			parentsOf.set(line.childId, [...(parentsOf.get(line.childId) ?? []), parentId]);
			childrenOf.set(parentId, [...(childrenOf.get(parentId) ?? []), line.childId]);
		}
	const walk = (from: string, next: Map<string, string[]>) => {
		const found = new Set<string>();
		const stack = [from];
		while (stack.length > 0)
			for (const id of next.get(stack.pop()!) ?? [])
				if (!found.has(id) && id !== from) {
					found.add(id);
					stack.push(id);
				}
		return found;
	};
	const partnerIds = new Set(
		layout.unions
			.filter((u) => u.partnerIds.includes(personId))
			.flatMap((u) => u.partnerIds)
			.filter((id) => id !== personId)
	);
	return {
		ancestorIds: walk(personId, parentsOf),
		descendantIds: walk(personId, childrenOf),
		partnerIds
	};
}
