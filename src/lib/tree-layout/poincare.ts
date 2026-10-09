/**
 * The Ball view: everyone inside a see-through unit ball, height is calendar time (the oldest at
 * the top pole) and distance from the axis is compressed hyperbolically towards the glass, so a
 * wide generation never clips. Pure: the WebGL scene scales these unit-ball coordinates and turns
 * them into meshes, so everything here is testable without a browser.
 *
 * The same selection feeds every view (`selectFocusSubgraph`). Heights come from `eras.ts`, which
 * estimates a year for people with no dates; those estimates only choose a latitude. They are
 * never returned as dates, and a private person's own dates are never read.
 */

import { estimateEras } from './eras.js';
import { buildIndex, type GraphIndex } from './graph-index.js';
import { circularMean } from './rings.js';
import { selectFocusSubgraph } from './select.js';
import type {
	Band,
	FocusViewOptions,
	ParentChildType,
	RelationshipGraph,
	RelationshipGraphPerson,
	TreeSelection
} from './types.js';

/**
 * Euclidean radius of a sphere in unit-ball coordinates is `POINCARE_SPHERE_K · (1 − |p|²)`: the
 * conformal factor of the Poincaré ball, so a person near the glass is smaller, as if further off.
 */
const POINCARE_SPHERE_K = 0.08;
/** Gap between neighbouring spheres, as a multiple of their diameters. */
const SPACING = 1.35;
/** The highest and lowest latitude a person can stand at: the poles are too small to stand on. */
const MAX_LATITUDE = 0.8;
/** The time axis spans at least this many years, so two close generations do not fill the ball. */
const MIN_SPAN_YEARS = 150;
/** `spread` of the focus line; collateral bands and later siblings add to it. */
const CORE_SPREAD = 0.35;
const BAND_SPREAD = 0.55;
const SIBLING_SPREAD = 0.1;
const MAX_SIBLING_STEPS = 4;
/** Share of a slice's circumference people may fill before the whole slice moves outward. */
const MAX_FILL = 0.92;
const TAU = Math.PI * 2;

interface PoincarePerson {
	id: string;
	/** Rows relative to the focus: negative above, positive below. */
	generation: number;
	band: Band;
	/** Unit-ball coordinates: |(x, y, z)| < 1, y up with the oldest at the top. */
	x: number;
	y: number;
	z: number;
	/** Euclidean radius of the sphere in the same units, from the conformal factor. */
	radius: number;
	person: RelationshipGraphPerson;
}

interface PoincareUnion {
	id: string;
	generation: number;
	/** The partners' midpoint, where the children's lines leave. */
	x: number;
	y: number;
	z: number;
	/** Drawn partners in `union_partner` order. */
	partnerIds: string[];
}

interface PoincareChildLink {
	childId: string;
	fromUnionId: string | null;
	/** Set when `fromUnionId` is null. */
	fromPersonId: string | null;
	type: ParentChildType;
	/** The drawn parents this line stands for, so a lineage walk can follow it. */
	parentIds: string[];
}

/** A latitude ring on the glass, labelled with a real calendar year. */
interface PoincareTick {
	year: number;
	/** Unit-ball height. */
	y: number;
	/** Centuries and half-centuries are drawn stronger than the decades between. */
	isMajor: boolean;
}

export interface PoincareLayout {
	/** Null when the whole tree is drawn; nobody is then the focus. */
	focusPersonId: string | null;
	people: PoincarePerson[];
	unions: PoincareUnion[];
	childLinks: PoincareChildLink[];
	collapsedPersonIds: string[];
	/** False when nobody drawn has a date: heights then only follow generations and no years show. */
	hasDates: boolean;
	ticks: PoincareTick[];
}

const EMPTY_POINCARE_LAYOUT: PoincareLayout = {
	focusPersonId: null,
	people: [],
	unions: [],
	childLinks: [],
	collapsedPersonIds: [],
	hasDates: false,
	ticks: []
};

/** Households on one generation: people joined by drawn partnerships, as a chain. */
function households(
	members: string[],
	generationOf: Map<string, number>,
	partnersOf: Map<string, string[]>
): string[][] {
	const seen = new Set<string>();
	const order = new Map(members.map((id, i) => [id, i]));
	const result: string[][] = [];
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

interface Arc {
	members: string[];
	want: number;
	at: number;
	span: number;
}

/** Pushes neighbouring arcs apart until none overlap, keeping each near where it wants to be. */
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

/** Angle one sphere needs at hyperbolic `spread` on a slice of disc radius `discRadius`. */
function slotAngle(discRadius: number, spread: number): number {
	// Arc length is r·Δθ with r = R·tanh(spread); a sphere is K·(1−|p|²) = K·R²/cosh²(spread)
	// across, so Δθ = 2·SPACING·K·R / (sinh·cosh) = 4·SPACING·K·R / sinh(2·spread).
	return (4 * SPACING * POINCARE_SPHERE_K * discRadius) / Math.sinh(2 * spread);
}

const wrap = (angle: number) => ((angle % TAU) + TAU) % TAU;

/** Rounded so identical inputs serialise identically. */
const round = (value: number) => Math.round(value * 1e6) / 1e6;

/**
 * Lay out Ball around `focusPersonId`. Returns the empty layout when the person is not in the
 * graph.
 */
export function layoutPoincare(
	graph: RelationshipGraph,
	focusPersonId: string | null | undefined,
	options: FocusViewOptions = {},
	index: GraphIndex = buildIndex(graph),
	given?: TreeSelection
): PoincareLayout {
	if (!given && !focusPersonId) return EMPTY_POINCARE_LAYOUT;
	const selection = given ?? selectFocusSubgraph(graph, focusPersonId!, options, index);
	if (!selection) return EMPTY_POINCARE_LAYOUT;

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

	// Which union (or lone parent) each child's line leaves from, as on the rings.
	const drawnUnionIds = new Set(drawnUnions.map((u) => u.id));
	const childLinks: PoincareChildLink[] = [];
	for (const child of selection.people) {
		const byUnion = new Map<string, PoincareChildLink>();
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
			const line: PoincareChildLink = {
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
	const parentAnchorsOf = new Map<string, PoincareChildLink[]>();
	for (const line of childLinks)
		parentAnchorsOf.set(line.childId, [...(parentAnchorsOf.get(line.childId) ?? []), line]);

	// --- Height: one era per partnership component, so partners share a latitude. ---
	const personOf = (id: string) => index.personById.get(id)!;
	const estimate = estimateEras(
		selection.people.map((p) => ({
			id: p.id,
			generation: p.generation,
			birthDate: personOf(p.id).birthDate,
			deathDate: personOf(p.id).deathDate,
			isPrivate: personOf(p.id).isPrivate === true
		})),
		{
			parentChild: childLinks.flatMap((l) =>
				l.parentIds.map((parentId) => ({ parentId, childId: l.childId }))
			),
			partners: drawnUnions.flatMap((u) => {
				const partners = u.partnerIds.filter(isDrawn);
				return partners.slice(1).map((id): [string, string] => [partners[0], id]);
			})
		}
	);
	const componentOf = new Map<string, string>();
	const rootOf = (id: string): string => {
		let root = id;
		while (componentOf.get(root) !== root) root = componentOf.get(root)!;
		return root;
	};
	for (const p of selection.people) componentOf.set(p.id, p.id);
	for (const [id, partners] of partnersOf)
		for (const other of partners) componentOf.set(rootOf(id), rootOf(other));
	const sums = new Map<string, { total: number; count: number }>();
	for (const p of selection.people) {
		const entry = sums.get(rootOf(p.id)) ?? { total: 0, count: 0 };
		entry.total += estimate.eras.get(p.id)!;
		entry.count += 1;
		sums.set(rootOf(p.id), entry);
	}
	const eraOf = (id: string) => {
		const entry = sums.get(rootOf(id))!;
		return entry.total / entry.count;
	};
	const eraValues = selection.people.map((p) => eraOf(p.id));
	const oldest = Math.min(...eraValues);
	const newest = Math.max(...eraValues);
	const span = Math.max(newest - oldest, MIN_SPAN_YEARS);
	const middle = (oldest + newest) / 2;
	const latitudeOf = (era: number) => (-MAX_LATITUDE * (era - middle)) / (span / 2);

	// --- Distance from the axis: the focus line nearest, cousins and later siblings outward. ---
	const siblingRank = new Map<string, number>();
	const groups = new Map<string, string[]>();
	for (const p of selection.people) {
		const first = parentAnchorsOf.get(p.id)?.[0];
		if (!first) continue;
		const key = first.fromUnionId !== null ? `u:${first.fromUnionId}` : `p:${first.fromPersonId}`;
		groups.set(key, [...(groups.get(key) ?? []), p.id]);
	}
	for (const ids of groups.values())
		ids
			.sort((a, b) => eraOf(a) - eraOf(b) || (a < b ? -1 : 1))
			.forEach((id, rank) => siblingRank.set(id, rank));
	const spreadOf = new Map<string, number>();
	const discOf = new Map<string, number>();
	for (const p of selection.people) {
		const rank = p.band === 0 ? 0 : Math.min(siblingRank.get(p.id) ?? 0, MAX_SIBLING_STEPS);
		spreadOf.set(p.id, CORE_SPREAD + p.band * BAND_SPREAD + rank * SIBLING_SPREAD);
		discOf.set(p.id, Math.sqrt(1 - latitudeOf(eraOf(p.id)) ** 2));
	}

	// --- Angles, generation by generation from the oldest, as the rings do. ---
	const angleOf = new Map<string, number>();
	const shiftOfGeneration = new Map<number, number>();
	const unionAngle = new Map<string, number>();
	const generations = [...new Set(selection.people.map((p) => p.generation))].sort((a, b) => a - b);
	for (const generation of generations) {
		const members = selection.people.filter((p) => p.generation === generation).map((p) => p.id);
		// The whole slice moves outward together until everyone fits round it.
		const slots = (shift: number) =>
			members.reduce((sum, id) => sum + slotAngle(discOf.get(id)!, spreadOf.get(id)! + shift), 0);
		let shift = 0;
		if (slots(0) > TAU * MAX_FILL) {
			let low = 0;
			let high = 8;
			for (let i = 0; i < 40; i++) {
				const mid = (low + high) / 2;
				if (slots(mid) > TAU * MAX_FILL) low = mid;
				else high = mid;
			}
			shift = high;
		}
		shiftOfGeneration.set(generation, shift);
		const slotOf = (id: string) => slotAngle(discOf.get(id)!, spreadOf.get(id)! + shift);

		const arcs: Arc[] = households(members, generationOf, partnersOf).map((house, i, all) => {
			const parentAngles = house.flatMap((id) =>
				(parentAnchorsOf.get(id) ?? [])
					.map((line) =>
						line.fromUnionId !== null
							? unionAngle.get(line.fromUnionId)
							: angleOf.get(line.fromPersonId!)
					)
					.filter((a): a is number => a !== undefined)
			);
			const want = circularMean(parentAngles) ?? (i / all.length) * TAU;
			return {
				members: house,
				want,
				at: want,
				span: house.reduce((sum, id) => sum + slotOf(id), 0)
			};
		});
		arcs.sort((a, b) => a.want - b.want);
		separate(arcs);
		for (const arc of arcs) {
			let cursor = arc.at - arc.span / 2;
			for (const id of arc.members) {
				angleOf.set(id, wrap(cursor + slotOf(id) / 2));
				cursor += slotOf(id);
			}
		}
		for (const u of drawnUnions) {
			const partners = u.partnerIds.filter(isDrawn);
			if (generationOf.get(partners[0]) !== generation) continue;
			const angles = partners.filter((id) => angleOf.has(id)).map((id) => angleOf.get(id)!);
			const angle = circularMean(angles) ?? angles[0];
			if (angle !== undefined) unionAngle.set(u.id, angle);
		}
	}

	// --- Positions inside the ball, then a pass to part spheres of different slices that meet. ---
	interface Spot {
		id: string;
		y: number;
		r: number;
		angle: number;
	}
	const spots: Spot[] = selection.people.map((p) => {
		const disc = discOf.get(p.id)!;
		const spread = spreadOf.get(p.id)! + shiftOfGeneration.get(p.generation)!;
		return {
			id: p.id,
			y: latitudeOf(eraOf(p.id)),
			r: disc * Math.tanh(spread),
			angle: angleOf.get(p.id)!
		};
	});
	const sphereRadius = (s: Spot) => POINCARE_SPHERE_K * (1 - s.y * s.y - s.r * s.r);
	const coordinates = (s: Spot) => [s.r * Math.cos(s.angle), s.y, s.r * Math.sin(s.angle)] as const;
	for (let sweep = 0; sweep < 30; sweep++) {
		let didMove = false;
		for (let i = 0; i < spots.length; i++)
			for (let j = i + 1; j < spots.length; j++) {
				const a = spots[i];
				const b = spots[j];
				const [ax, ay, az] = coordinates(a);
				const [bx, by, bz] = coordinates(b);
				const distance = Math.hypot(ax - bx, ay - by, az - bz);
				const needed = (sphereRadius(a) + sphereRadius(b)) * SPACING;
				if (distance >= needed || a.r + b.r < 1e-6) continue;
				const push = (needed - distance + 1e-4) / (a.r + b.r);
				// Opposite ways round the axis; the order of the pair breaks exact ties.
				const direction = wrap(a.angle - b.angle + Math.PI) - Math.PI >= 0 ? 1 : -1;
				a.angle += direction * push * (b.r / (a.r + b.r));
				b.angle -= direction * push * (a.r / (a.r + b.r));
				didMove = true;
			}
		if (!didMove) break;
	}

	const placed = new Map(spots.map((s) => [s.id, coordinates(s)]));
	const people: PoincarePerson[] = selection.people.map((p, i) => {
		const [x, y, z] = placed.get(p.id)!;
		return {
			id: p.id,
			generation: p.generation,
			band: p.band,
			x: round(x),
			y: round(y),
			z: round(z),
			radius: round(sphereRadius(spots[i])),
			person: personOf(p.id)
		};
	});
	const unions: PoincareUnion[] = drawnUnions.flatMap((u) => {
		const partnerIds = u.partnerIds.filter(isDrawn);
		const at = partnerIds.map((id) => placed.get(id)!);
		if (at.length === 0) return [];
		const mean = (axis: 0 | 1 | 2) => round(at.reduce((sum, c) => sum + c[axis], 0) / at.length);
		return [
			{
				id: u.id,
				generation: generationOf.get(partnerIds[0])!,
				x: mean(0),
				y: mean(1),
				z: mean(2),
				partnerIds
			}
		];
	});
	const placedUnionIds = new Set(unions.map((u) => u.id));

	// Latitude rings at round calendar years, only when there are dates to anchor them.
	const ticks: PoincareTick[] = [];
	if (estimate.hasDates) {
		const step = span >= 300 ? 100 : 10;
		const yearAtTop = middle - span / 2;
		const yearAtBottom = middle + span / 2;
		for (let year = Math.ceil(yearAtTop / step) * step; year <= yearAtBottom; year += step)
			ticks.push({
				year,
				y: round(latitudeOf(year)),
				isMajor: year % 100 === 0 || (step === 10 && year % 50 === 0)
			});
	}

	return {
		focusPersonId: selection.focusPersonId,
		people,
		unions,
		childLinks: childLinks.filter(
			(line) => line.fromUnionId === null || placedUnionIds.has(line.fromUnionId)
		),
		collapsedPersonIds: selection.collapsedPersonIds,
		hasDates: estimate.hasDates,
		ticks
	};
}
