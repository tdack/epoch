/**
 * The Orrery view: a star cluster. Each person is a star; a union's partners are a binary held at
 * a fixed distance, and their children are drawn toward the partners' shared barycentre (the
 * midpoint, not either parent). A person with several unions is the shared star of several
 * binaries, which settle round them as a hierarchical system. A union is never called a marriage.
 *
 * The cluster comes from a force simulation run to rest inside this call, a fixed number of
 * iterations seeded from a hash of person ids, so the same graph always gives the same picture.
 * Pure: the WebGL scene turns these positions into meshes, and `orrery-orbit.ts` adds the purely
 * visual drift.
 *
 * The same selection feeds every view (`selectFocusSubgraph`), so Orrery draws exactly who Flat or
 * Rings would for the same address, with no new fetch rules or privacy surface.
 */

import { buildIndex, type GraphIndex } from './graph-index.js';
import {
	runSimulation,
	type SimBarycentreLink,
	type SimBody,
	type SimSpring
} from './orrery-simulation.js';
import { selectFocusSubgraph } from './select.js';
import type {
	Band,
	FocusViewOptions,
	ParentChildType,
	RelationshipGraph,
	RelationshipGraphPerson,
	TreeSelection
} from './types.js';

/** Distance a union's first binary holds its partners at, in scene units. */
export const ORRERY_BINARY_UNITS = 4;
/** Each later union of a shared star sits this much further out, as a fraction of the base. */
const HIERARCHY_STEP = 0.35;
/** Where a child settles from its parents' barycentre. */
const CHILD_REST_UNITS = 5.5;
/** A direct parent link has no barycentre, so the child settles from the parent itself. */
const DIRECT_REST_UNITS = 6;
/** Vertical spacing of generations; weak, so the cluster reads as a cluster, not as rows. */
const GENERATION_UNITS = 4.5;

const BINARY_STRENGTH = 0.32;
const CHILD_STRENGTH = 0.07;
const DIRECT_STRENGTH = 0.05;

/** The fixed iteration budget; the simulation may stop earlier when it comes to rest. */
export const ORRERY_ITERATIONS = 260;
/** Past this many bodies the budget shrinks, so a 3,000-person tree still lays out in about a second. */
const FULL_BUDGET_PEOPLE = 1000;
/** The budget never shrinks below this, so binaries and child springs still settle. */
const MIN_ITERATIONS = 120;
/** The plan said about 300; measured, the exact pass is still faster up to roughly 700 bodies. */
const BARNES_HUT_THRESHOLD = 700;
const ROUND = 1000;

interface OrreryPerson {
	id: string;
	/** Rows relative to the focus: positive toward descendants, as on Rings. */
	generation: number;
	band: Band;
	/** Scene units, focus at the origin. */
	x: number;
	y: number;
	z: number;
	person: RelationshipGraphPerson;
}

interface OrreryUnion {
	id: string;
	/** Drawn partners in `union_partner` order. */
	partnerIds: string[];
	/** Barycentre of the drawn partners: where the children's lines leave. */
	x: number;
	y: number;
	z: number;
	/** The distance this union's binary was held at; later unions of one star sit further out. */
	distance: number;
}

/**
 * A parent-child line. It leaves the union's barycentre when the child is asserted within a drawn
 * one, else the parent's own star.
 */
interface OrreryChildLink {
	childId: string;
	fromUnionId: string | null;
	/** Set when `fromUnionId` is null. */
	fromPersonId: string | null;
	type: ParentChildType;
	/** The drawn parents this line stands for, so a lineage walk can follow it. */
	parentIds: string[];
}

export interface OrreryLayout {
	/** Null when the whole tree is drawn; nobody is then the focus. */
	focusPersonId: string | null;
	people: OrreryPerson[];
	unions: OrreryUnion[];
	childLinks: OrreryChildLink[];
	/** Iterations the simulation ran, at most {@link ORRERY_ITERATIONS}. */
	iterations: number;
}

const EMPTY_ORRERY_LAYOUT: OrreryLayout = {
	focusPersonId: null,
	people: [],
	unions: [],
	childLinks: [],
	iterations: 0
};

/** FNV-1a over the id, then a final mix; stable across runs and independent of list order. */
function hash(text: string, salt: number): number {
	let h = (2166136261 ^ salt) >>> 0;
	for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
	h ^= h >>> 15;
	h = Math.imul(h, 2246822519) >>> 0;
	h ^= h >>> 13;
	return h >>> 0;
}

/** A number in [0, 1) from an id; `salt` gives independent streams for x, y and z. */
export function unitFromId(id: string, salt: number): number {
	return hash(id, salt) / 4294967296;
}

/** Iterations for a layout of `count` bodies: the full budget, less for the largest trees. */
function iterationsFor(count: number): number {
	if (count <= FULL_BUDGET_PEOPLE) return ORRERY_ITERATIONS;
	return Math.max(MIN_ITERATIONS, Math.round((ORRERY_ITERATIONS * FULL_BUDGET_PEOPLE) / count));
}

export interface OrreryOptions {
	/** Overrides for tests: the iteration budget and the Barnes–Hut cut-over. */
	iterations?: number;
	barnesHutThreshold?: number;
}

/**
 * Lay out the Orrery around `focusPersonId`. Returns the empty layout when the person is not in the
 * graph.
 */
export function layoutOrrery(
	graph: RelationshipGraph,
	focusPersonId: string | null | undefined,
	options: FocusViewOptions = {},
	index: GraphIndex = buildIndex(graph),
	tuning: OrreryOptions = {},
	given?: TreeSelection
): OrreryLayout {
	if (!given && !focusPersonId) return EMPTY_ORRERY_LAYOUT;
	const selection = given ?? selectFocusSubgraph(graph, focusPersonId!, options, index);
	if (!selection || selection.people.length === 0) return EMPTY_ORRERY_LAYOUT;

	const slotOf = new Map(selection.people.map((p, i) => [p.id, i]));
	// With no focus (the whole tree) gravity pulls to the centroid instead. Anchoring it to some
	// person (the oldest, say) would drag a 3,000-person picture toward one arbitrary star.
	const anchorSlot = selection.focusPersonId === null ? null : slotOf.get(selection.focusPersonId);
	const isDrawn = (id: string) => slotOf.has(id);
	const drawnUnions = selection.unions
		.map((u) => index.unionById.get(u.id)!)
		.filter((u) => u.partnerIds.some(isDrawn));
	const drawnUnionIds = new Set(drawnUnions.map((u) => u.id));

	// Which union (or lone parent) each child's line leaves from; the same grouping as Rings.
	const childLinks: OrreryChildLink[] = [];
	for (const child of selection.people) {
		const byKey = new Map<string, OrreryChildLink>();
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
			const line: OrreryChildLink = {
				childId: child.id,
				fromUnionId: isUnionLine ? union.id : null,
				fromPersonId: isUnionLine ? null : link.parentId,
				type: link.type,
				parentIds: [link.parentId]
			};
			byKey.set(key, line);
			childLinks.push(line);
		}
	}

	// Seeded start: x and z from the id hash, y near the generation's level.
	const count = selection.people.length;
	const spread = 4 + 2.2 * Math.sqrt(count);
	const bodies: SimBody[] = selection.people.map((p) => ({
		x: (unitFromId(p.id, 1) - 0.5) * spread,
		y: p.generation * GENERATION_UNITS + (unitFromId(p.id, 2) - 0.5) * 2,
		z: (unitFromId(p.id, 3) - 0.5) * spread,
		restY: p.generation * GENERATION_UNITS
	}));

	// A star's unions in order give each later one a wider orbit: the hierarchical system.
	const unionsOfDrawn = (personId: string) =>
		(index.unionsOfPerson.get(personId) ?? []).filter((u) => drawnUnionIds.has(u.id));
	const distanceOf = new Map<string, number>();
	const springs: SimSpring[] = [];
	const boundPairs: Array<[number, number]> = [];
	const boundKeys = new Map<string, number>();
	for (const u of drawnUnions) {
		const partners = u.partnerIds.filter(isDrawn);
		const rank = Math.max(
			0,
			...partners.map((id) => unionsOfDrawn(id).findIndex((other) => other.id === u.id))
		);
		const distance = ORRERY_BINARY_UNITS * (1 + HIERARCHY_STEP * rank);
		distanceOf.set(u.id, distance);
		// Three or more partners hold as a chain in `union_partner` order.
		for (let i = 0; i + 1 < partners.length; i++) {
			const a = slotOf.get(partners[i])!;
			const b = slotOf.get(partners[i + 1])!;
			// Repeated unions between the same people share one binary: two springs of different
			// lengths between the same stars would only fight.
			const key = a < b ? `${a}:${b}` : `${b}:${a}`;
			const shared = boundKeys.get(key);
			if (shared !== undefined) {
				distanceOf.set(u.id, shared);
				continue;
			}
			boundKeys.set(key, distance);
			springs.push({ a, b, restUnits: distance, strength: BINARY_STRENGTH });
			boundPairs.push([a, b]);
		}
	}

	const links: SimBarycentreLink[] = [];
	for (const line of childLinks) {
		const child = slotOf.get(line.childId)!;
		if (line.fromUnionId !== null) {
			const parents = index.unionById
				.get(line.fromUnionId)!
				.partnerIds.filter(isDrawn)
				.map((id) => slotOf.get(id)!);
			links.push({ child, parents, restUnits: CHILD_REST_UNITS, strength: CHILD_STRENGTH });
		} else {
			links.push({
				child,
				parents: [slotOf.get(line.fromPersonId!)!],
				restUnits: DIRECT_REST_UNITS,
				strength: DIRECT_STRENGTH
			});
		}
	}

	const { iterations } = runSimulation(bodies, springs, links, {
		iterations: tuning.iterations ?? iterationsFor(count),
		boundPairs,
		gravityTo: anchorSlot ?? null,
		barnesHutThreshold: tuning.barnesHutThreshold ?? BARNES_HUT_THRESHOLD
	});

	// The focus (else the centroid) is the origin, so the camera's target and the names' reading
	// order stay stable.
	let ox = 0;
	let oy = 0;
	let oz = 0;
	if (anchorSlot !== null && anchorSlot !== undefined) {
		({ x: ox, y: oy, z: oz } = bodies[anchorSlot]);
	} else {
		for (const b of bodies) {
			ox += b.x;
			oy += b.y;
			oz += b.z;
		}
		ox /= bodies.length;
		oy /= bodies.length;
		oz /= bodies.length;
	}
	const round = (value: number) => Math.round(value * ROUND) / ROUND;
	const people = selection.people.map((p, i) => ({
		id: p.id,
		generation: p.generation,
		band: p.band,
		x: round(bodies[i].x - ox),
		y: round(bodies[i].y - oy),
		z: round(bodies[i].z - oz),
		person: index.personById.get(p.id)!
	}));

	const unions = drawnUnions.map((u) => {
		const partnerIds = u.partnerIds.filter(isDrawn);
		const at = { x: 0, y: 0, z: 0 };
		for (const id of partnerIds) {
			const person = people[slotOf.get(id)!];
			at.x += person.x;
			at.y += person.y;
			at.z += person.z;
		}
		return {
			id: u.id,
			partnerIds,
			x: round(at.x / partnerIds.length),
			y: round(at.y / partnerIds.length),
			z: round(at.z / partnerIds.length),
			distance: distanceOf.get(u.id)!
		};
	});

	return { focusPersonId: selection.focusPersonId, people, unions, childLinks, iterations };
}
