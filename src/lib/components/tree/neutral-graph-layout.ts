/**
 * Pure layout for the read-only relationship graph (Phase 2).
 *
 * Unlike the legacy `tree-layout.ts` (which merges repeated unions by spouse
 * pair), this layout consumes the neutral {@link RelationshipGraph} and never
 * collapses repeated unions or single-parent groups. Each union is its own
 * node; parent-child links carry their per-parent type; partner links connect
 * people to their union node.
 *
 * When a focus person is given, the layout selects a subgraph centred on that
 * person (ancestors above, descendants below, partners alongside) and anchors
 * their position at the origin so the UI can centre the view on them.
 */

import type {
	RelationshipGraph,
	RelationshipGraphPerson,
	RelationshipGraphUnion,
	GraphParentChildInput
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
	/** The focus person this layout is centred on, if any. */
	focusPersonId: string | null;
}

export interface FocusOptions {
	/** Max generations of ancestors to include above the focus person. */
	ancestorDepth?: number;
	/** Max generations of descendants to include below the focus person. */
	descendantDepth?: number;
}

const GEN_HEIGHT = 170;
const UNION_GAP = 260;

/**
 * Select the subgraph reachable from a focus person within the given depths.
 * The focus person, their partners/unions, and descendants up to the depth are
 * always included; ancestors are included up to their depth.
 */
export function selectFocusedGraph(
	graph: RelationshipGraph,
	focusPersonId: string,
	options: FocusOptions = {}
): RelationshipGraph {
	const ancestorDepth = options.ancestorDepth ?? 4;
	const descendantDepth = options.descendantDepth ?? 4;

	if (!graph.people.some((p) => p.id === focusPersonId)) {
		return graph;
	}

	const childrenByParent = new Map<string, GraphParentChildInput[]>();
	const parentsByChild = new Map<string, GraphParentChildInput[]>();
	for (const pc of graph.parentChild) {
		const c = childrenByParent.get(pc.parentId) ?? [];
		c.push(pc);
		childrenByParent.set(pc.parentId, c);

		const p = parentsByChild.get(pc.childId) ?? [];
		p.push(pc);
		parentsByChild.set(pc.childId, p);
	}
	const unionById = new Map(graph.unions.map((u) => [u.id, u]));

	const includedPeople = new Set<string>([focusPersonId]);
	const includedUnions = new Set<string>();

	const childQueue: Array<{ id: string; depth: number }> = [{ id: focusPersonId, depth: 0 }];
	while (childQueue.length > 0) {
		const { id, depth } = childQueue.shift()!;
		if (depth >= descendantDepth) continue;
		for (const pc of childrenByParent.get(id) ?? []) {
			if (!includedPeople.has(pc.childId)) {
				includedPeople.add(pc.childId);
				childQueue.push({ id: pc.childId, depth: depth + 1 });
			}
			if (pc.unionId) includedUnions.add(pc.unionId);
		}
	}

	const parentQueue: Array<{ id: string; depth: number }> = [{ id: focusPersonId, depth: 0 }];
	while (parentQueue.length > 0) {
		const { id, depth } = parentQueue.shift()!;
		if (depth >= ancestorDepth) continue;
		for (const pc of parentsByChild.get(id) ?? []) {
			if (!includedPeople.has(pc.parentId)) {
				includedPeople.add(pc.parentId);
				parentQueue.push({ id: pc.parentId, depth: depth + 1 });
			}
			if (pc.unionId) includedUnions.add(pc.unionId);
		}
	}

	const focusUnionIds = graph.unions.filter((u) => u.partnerIds.includes(focusPersonId)).map((u) => u.id);
	for (const uid of focusUnionIds) {
		includedUnions.add(uid);
		const u = unionById.get(uid);
		if (!u) continue;
		for (const partnerId of u.partnerIds) {
			includedPeople.add(partnerId);
		}
	}

	for (const pc of graph.parentChild) {
		if (includedPeople.has(pc.parentId) && includedPeople.has(pc.childId) && pc.unionId) {
			includedUnions.add(pc.unionId);
		}
	}

	return {
		people: graph.people.filter((p) => includedPeople.has(p.id)),
		unions: graph.unions.filter((u) => includedUnions.has(u.id)),
		parentChild: graph.parentChild.filter(
			(pc) => includedPeople.has(pc.parentId) && includedPeople.has(pc.childId)
		)
	};
}

/**
 * Assign generations by walking parent→child edges. When a focus person is
 * given, they anchor generation 0 (ancestors negative, descendants positive);
 * otherwise people with no parents anchor generation 0. Cycles are tolerated.
 */
function assignGenerations(graph: RelationshipGraph, focusPersonId: string | null): Map<string, number> {
	const gen = new Map<string, number>();

	if (focusPersonId) {
		gen.set(focusPersonId, 0);
		const queue = [focusPersonId];
		while (queue.length > 0) {
			const id = queue.shift()!;
			const g = gen.get(id)!;

			for (const pc of graph.parentChild) {
				if (pc.parentId === id && !gen.has(pc.childId)) {
					gen.set(pc.childId, g + 1);
					queue.push(pc.childId);
				}
			}
			for (const pc of graph.parentChild) {
				if (pc.childId === id && !gen.has(pc.parentId)) {
					gen.set(pc.parentId, g - 1);
					queue.push(pc.parentId);
				}
			}
			for (const u of graph.unions) {
				if (!u.partnerIds.includes(id)) continue;
				for (const partnerId of u.partnerIds) {
					if (!gen.has(partnerId)) {
						gen.set(partnerId, g);
						queue.push(partnerId);
					}
				}
			}
		}
	} else {
		const hasParent = new Set(graph.parentChild.map((pc) => pc.childId));
		for (const p of graph.people) {
			if (!hasParent.has(p.id)) gen.set(p.id, 0);
		}

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
export function buildNeutralGraphLayout(
	graph: RelationshipGraph,
	options: FocusOptions & { focusPersonId?: string | null } = {}
): NeutralGraphLayout {
	const focusPersonId = options.focusPersonId ?? null;

	const workingGraph = focusPersonId ? selectFocusedGraph(graph, focusPersonId, options) : graph;

	const people = new Map<string, LaidOutPerson>();
	const unions: LaidOutUnion[] = [];
	const links: GraphLink[] = [];

	const gen = assignGenerations(workingGraph, focusPersonId);

	const ordered = [...workingGraph.people].sort((a, b) => {
		const ga = gen.get(a.id) ?? 0;
		const gb = gen.get(b.id) ?? 0;
		if (ga !== gb) return ga - gb;
		if (a.id === focusPersonId) return -1;
		if (b.id === focusPersonId) return 1;
		return 0;
	});

	const perGen = new Map<number, number>();
	for (const p of ordered) {
		const g = gen.get(p.id) ?? 0;
		const x = perGen.get(g) ?? 0;
		perGen.set(g, x + UNION_GAP);
		people.set(p.id, { id: p.id, x, y: g * GEN_HEIGHT, person: p });
	}

	if (focusPersonId) {
		const focus = people.get(focusPersonId);
		if (focus) {
			const dx = -focus.x;
			const dy = -focus.y;
			for (const p of people.values()) {
				p.x += dx;
				p.y += dy;
			}
		}
	}

	for (const u of workingGraph.unions) {
		const partnerPositions = u.partnerIds
			.map((id) => people.get(id))
			.filter((p): p is LaidOutPerson => Boolean(p));

		let x: number;
		let y: number;
		if (partnerPositions.length > 0) {
			x = partnerPositions.reduce((sum, p) => sum + p.x, 0) / partnerPositions.length;
			y = partnerPositions.reduce((sum, p) => sum + p.y, 0) / partnerPositions.length;
		} else {
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

	for (const pc of workingGraph.parentChild) {
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

	return { people: [...people.values()], unions, links, focusPersonId };
}
