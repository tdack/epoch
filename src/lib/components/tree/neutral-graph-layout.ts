/**
 * Pure layout for the read-only relationship graph (Phase 2).
 *
 * Unlike the legacy `tree-layout.ts` (which merges repeated unions by spouse
 * pair), this layout consumes the neutral {@link RelationshipGraph} and never
 * collapses repeated unions or single-parent groups. Each union is its own
 * node; parent-child links carry their per-parent type; partner links connect
 * people to their union node.
 */

import type {
	RelationshipGraph,
	RelationshipGraphPerson,
	RelationshipGraphUnion
} from '#lib/server/domain/relationship-graph.js';

export interface LaidOutPerson {
	id: string;
	x: number;
	y: number;
	person: RelationshipGraphPerson;
}

export interface LaidOutUnion {
	id: string;
	x: number;
	y: number;
	union: RelationshipGraphUnion;
}

export type GraphLinkType = 'partner' | 'parent_child';

export interface GraphLink {
	type: GraphLinkType;
	/** The relationship type for parent_child links. */
	relationshipType?: string;
	sourceId: string;
	targetId: string;
	source: { x: number; y: number };
	target: { x: number; y: number };
}

export interface NeutralGraphLayout {
	people: LaidOutPerson[];
	unions: LaidOutUnion[];
	links: GraphLink[];
}

const GEN_HEIGHT = 160;
const UNION_GAP = 260;

/**
 * Assign generations by walking parent→child edges (parents are one generation
 * above children). Cycles are tolerated (first assignment wins) so unusual
 * histories never throw.
 */
function assignGenerations(graph: RelationshipGraph): Map<string, number> {
	const gen = new Map<string, number>();

	// Seed people with no recorded parents at generation 0.
	const hasParent = new Set(graph.parentChild.map((pc) => pc.childId));
	for (const p of graph.people) {
		if (!hasParent.has(p.id)) gen.set(p.id, 0);
	}

	// Relaxation: parent gen + 1 propagates to children.
	let changed = true;
	let iterations = 0;
	while (changed && iterations < 100) {
		changed = false;
		iterations++;
		for (const pc of graph.parentChild) {
			const parentGen = gen.get(pc.parentId);
			if (parentGen === undefined) continue;
			const childGen = gen.get(pc.childId);
			if (childGen === undefined || childGen < parentGen + 1) {
				gen.set(pc.childId, parentGen + 1);
				changed = true;
			}
		}
	}

	for (const p of graph.people) {
		if (!gen.has(p.id)) gen.set(p.id, 0);
	}

	return gen;
}

/**
 * Produce a collision-free layout for the neutral relationship graph.
 * Repeated unions are laid out as distinct union nodes side by side.
 */
export function buildNeutralGraphLayout(graph: RelationshipGraph): NeutralGraphLayout {
	const people = new Map<string, LaidOutPerson>();
	const unions: LaidOutUnion[] = [];
	const links: GraphLink[] = [];

	const gen = assignGenerations(graph);

	// Position people by generation, left to right in insertion order.
	const perGen = new Map<number, number>(); // next x slot per generation
	const personById = new Map(graph.people.map((p) => [p.id, p]));

	for (const p of graph.people) {
		const g = gen.get(p.id) ?? 0;
		const x = perGen.get(g) ?? 0;
		perGen.set(g, x + UNION_GAP);
		people.set(p.id, { id: p.id, x, y: g * GEN_HEIGHT, person: p });
	}

	// Lay out each union node between its partners (or near its children).
	for (const u of graph.unions) {
		const partnerPositions = u.partnerIds
			.map((id) => people.get(id))
			.filter((p): p is LaidOutPerson => Boolean(p));

		let x: number;
		let y: number;
		if (partnerPositions.length > 0) {
			x = partnerPositions.reduce((sum, p) => sum + p.x, 0) / partnerPositions.length;
			y = partnerPositions.reduce((sum, p) => sum + p.y, 0) / partnerPositions.length;
		} else {
			// Single-parent/child-only union: place near its children.
			const childPositions = u.children
				.map((c) => people.get(c.childId))
				.filter((p): p is LaidOutPerson => Boolean(p));
			x =
				childPositions.length > 0
					? childPositions.reduce((sum, p) => sum + p.x, 0) / childPositions.length
					: 0;
			y = childPositions.length > 0 ? childPositions[0].y - GEN_HEIGHT / 2 : 0;
		}

		unions.push({ id: u.id, x, y, union: u });

		// Partner links from each participant to the union node.
		for (const id of u.partnerIds) {
			const p = people.get(id);
			if (!p) continue;
			links.push({
				type: 'partner',
				sourceId: id,
				targetId: u.id,
				source: { x: p.x, y: p.y },
				target: { x, y }
			});
		}

		// Parent-child links from union node to each child.
		for (const c of u.children) {
			const child = people.get(c.childId);
			if (!child) continue;
			links.push({
				type: 'parent_child',
				relationshipType: c.type,
				sourceId: u.id,
				targetId: c.childId,
				source: { x, y },
				target: { x: child.x, y: child.y }
			});
		}
	}

	// Direct parent-child assertions (no union) become direct links.
	for (const pc of graph.parentChild) {
		if (pc.unionId !== null) continue;
		const parent = people.get(pc.parentId);
		const child = people.get(pc.childId);
		if (!parent || !child) continue;
		links.push({
			type: 'parent_child',
			relationshipType: pc.type,
			sourceId: pc.parentId,
			targetId: pc.childId,
			source: { x: parent.x, y: parent.y },
			target: { x: child.x, y: child.y }
		});
	}

	return { people: [...people.values()], unions, links };
}
