/**
 * Checkers for the layout contract. Each returns a list of
 * human-readable violations, empty when the layout complies, so a failing test names the offender.
 *
 * They live beside the layout (not in a test file) because the same checks are useful for
 * debugging a live tree and for future property tests.
 */

import {
	LAYOUT_METRICS,
	type ChildEdge,
	type LayoutEdge,
	type LayoutMetrics,
	type Point,
	type RelationshipGraph,
	type TreeLayout
} from './types.js';

const EPSILON = 0.5;

interface Box {
	id: string;
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

function cardBoxes(layout: TreeLayout, m: LayoutMetrics): Box[] {
	const boxes: Box[] = layout.people.map((p) => ({
		id: p.id,
		x0: p.x - m.cardWidth / 2,
		x1: p.x + m.cardWidth / 2,
		y0: p.y - m.cardHeight / 2,
		y1: p.y + m.cardHeight / 2
	}));
	for (const s of layout.stubs) {
		boxes.push({
			id: s.id,
			x0: s.x - m.stubWidth / 2,
			x1: s.x + m.stubWidth / 2,
			y0: s.y - m.stubHeight / 2,
			y1: s.y + m.stubHeight / 2
		});
	}
	return boxes;
}

function intersects(a: Box, b: Box): boolean {
	return (
		a.x0 < b.x1 - EPSILON && b.x0 < a.x1 - EPSILON && a.y0 < b.y1 - EPSILON && b.y0 < a.y1 - EPSILON
	);
}

/** Cards and stubs never overlap each other, and union nodes never sit on a card. */
export function findOverlaps(layout: TreeLayout, m: LayoutMetrics = LAYOUT_METRICS): string[] {
	const violations: string[] = [];
	const boxes = cardBoxes(layout, m);
	for (let i = 0; i < boxes.length; i++) {
		for (let j = i + 1; j < boxes.length; j++) {
			if (intersects(boxes[i], boxes[j])) violations.push(`${boxes[i].id} overlaps ${boxes[j].id}`);
		}
	}
	const nodes: Box[] = layout.unions.map((u) => ({
		id: u.id,
		x0: u.x - m.unionRadius,
		x1: u.x + m.unionRadius,
		y0: u.y - m.unionRadius,
		y1: u.y + m.unionRadius
	}));
	for (const node of nodes) {
		for (const b of boxes) {
			if (intersects(node, b)) violations.push(`union ${node.id} overlaps ${b.id}`);
		}
	}
	for (let i = 0; i < nodes.length; i++) {
		for (let j = i + 1; j < nodes.length; j++) {
			if (intersects(nodes[i], nodes[j]))
				violations.push(`union ${nodes[i].id} overlaps union ${nodes[j].id}`);
		}
	}
	return violations;
}

export function findDuplicatePeople(layout: TreeLayout): string[] {
	const seen = new Set<string>();
	const violations: string[] = [];
	for (const p of layout.people) {
		if (seen.has(p.id)) violations.push(`person ${p.id} drawn more than once`);
		seen.add(p.id);
	}
	return violations;
}

/** A union drawn twice also breaks the canvas, which keys its nodes by union id. */
function findDuplicateUnions(layout: TreeLayout): string[] {
	const seen = new Set<string>();
	const violations: string[] = [];
	for (const u of layout.unions) {
		if (seen.has(u.id)) violations.push(`union ${u.id} drawn more than once`);
		seen.add(u.id);
	}
	return violations;
}

/** Rule 1: every partner of a drawn union is drawn. */
export function findMissingPartners(graph: RelationshipGraph, layout: TreeLayout): string[] {
	const drawn = new Set(layout.people.map((p) => p.id));
	const unionById = new Map(graph.unions.map((u) => [u.id, u]));
	const violations: string[] = [];
	for (const placed of layout.unions) {
		const union = unionById.get(placed.id);
		for (const partnerId of union?.partnerIds ?? []) {
			if (!drawn.has(partnerId)) {
				violations.push(`union ${placed.id} is drawn without partner ${partnerId}`);
			}
		}
	}
	return violations;
}

/**
 * Rule 2: partners share a row and (when they can) sit adjacent with the union node between.
 * Unions the layout itself reported as non-adjacent are only checked for a shared row.
 */
export function findPartnerViolations(
	layout: TreeLayout,
	m: LayoutMetrics = LAYOUT_METRICS
): string[] {
	const violations: string[] = [];
	const personById = new Map(layout.people.map((p) => [p.id, p]));
	const nonAdjacent = new Set(layout.nonAdjacentUnionIds);
	for (const u of layout.unions) {
		const partners = u.union.partnerIds
			.map((id) => personById.get(id))
			.filter((p): p is NonNullable<typeof p> => Boolean(p));
		if (partners.some((p) => Math.abs(p.y - partners[0].y) > EPSILON)) {
			if (!nonAdjacent.has(u.id)) violations.push(`union ${u.id} partners are on different rows`);
			continue;
		}
		if (nonAdjacent.has(u.id) || partners.length < 2) continue;
		if (partners.length === 2 && !u.isHanging) {
			const [a, b] = [...partners].sort((p, q) => p.x - q.x);
			if (Math.abs(u.y - a.y) > EPSILON || u.x <= a.x || u.x >= b.x) {
				violations.push(`union ${u.id} is not between its partners`);
			}
			const between = layout.people.filter(
				(p) => p !== a && p !== b && Math.abs(p.y - a.y) < EPSILON && p.x > a.x && p.x < b.x
			);
			if (between.length > 0)
				violations.push(`union ${u.id} partners are separated by ${between[0].id}`);
			if (b.x - a.x < m.cardWidth + m.unionRadius) {
				violations.push(`union ${u.id} partners are too close for the union node`);
			}
		}
	}
	return violations;
}

/** Rule 4: one edge per (union, child); nothing drawn is missing its edge. */
export function findEdgeViolations(graph: RelationshipGraph, layout: TreeLayout): string[] {
	const violations: string[] = [];
	const keys = new Map<string, number>();
	const childEdges = layout.edges.filter((e): e is ChildEdge => e.kind === 'child');
	for (const e of childEdges) {
		const key = e.unionId
			? `${e.unionId}|${e.childId}`
			: `direct|${e.assertions[0]?.parentId}|${e.childId}`;
		keys.set(key, (keys.get(key) ?? 0) + 1);
	}
	for (const [key, n] of keys) if (n > 1) violations.push(`edge ${key} is drawn ${n} times`);

	const drawnPeople = new Set(layout.people.map((p) => p.id));
	const drawnUnions = new Set(layout.unions.map((u) => u.id));
	const expected = new Set<string>();
	for (const pc of graph.parentChild) {
		if (!drawnPeople.has(pc.childId) || !drawnPeople.has(pc.parentId)) continue;
		if (pc.unionId) {
			if (drawnUnions.has(pc.unionId)) expected.add(`${pc.unionId}|${pc.childId}`);
		} else {
			expected.add(`direct|${pc.parentId}|${pc.childId}`);
		}
	}
	for (const key of expected) if (!keys.has(key)) violations.push(`edge ${key} is missing`);
	for (const key of keys.keys())
		if (!expected.has(key)) violations.push(`edge ${key} has no assertion behind it`);

	for (const e of childEdges) {
		const types = [...new Set(e.assertions.map((a) => a.type))].sort();
		if (types.join() !== e.types.join())
			violations.push(`edge ${e.id} types do not match its assertions`);
	}
	return violations;
}

/** Rule 3: children are centred under their union (or parent), and siblings stay contiguous. */
export function findCentringViolations(layout: TreeLayout): string[] {
	const violations: string[] = [];
	const personById = new Map(layout.people.map((p) => [p.id, p]));
	const unionById = new Map(layout.unions.map((u) => [u.id, u]));
	const childEdges = layout.edges.filter((e): e is ChildEdge => e.kind === 'child');

	const incoming = new Map<string, number>();
	for (const e of childEdges) incoming.set(e.childId, (incoming.get(e.childId) ?? 0) + 1);

	const groups = new Map<string, ChildEdge[]>();
	for (const e of childEdges) {
		if (e.isSecondaryPath) continue;
		const key = e.unionId ?? `direct|${e.assertions[0]?.parentId}`;
		groups.set(key, [...(groups.get(key) ?? []), e]);
	}

	for (const [key, edges] of groups) {
		const anchorX = key.startsWith('direct|')
			? personById.get(key.slice('direct|'.length))?.x
			: unionById.get(key)?.x;
		if (anchorX === undefined) continue;
		const children = edges
			.map((e) => personById.get(e.childId))
			.filter((c): c is NonNullable<typeof c> => !!c);
		if (children.length === 0) continue;
		const xs = children.map((c) => c.x);
		const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
		// A child of two drawn unions (secondary path) sits between them, so only sole-parent
		// groups have a single anchor to centre under.
		const isSoleParent = children.every((c) => incoming.get(c.id) === 1);
		if (isSoleParent && Math.abs(mid - anchorX) > 1) {
			violations.push(`children of ${key} are not centred under it`);
		}

		// Siblings stay contiguous: only their own cards or their partners lie between them.
		const row = children[0].y;
		const lo = Math.min(...xs);
		const hi = Math.max(...xs);
		const siblingIds = new Set(children.map((c) => c.id));
		const allowed = new Set(siblingIds);
		for (const u of layout.unions) {
			if (u.union.partnerIds.some((id) => siblingIds.has(id))) {
				for (const id of u.union.partnerIds) allowed.add(id);
			}
		}
		for (const p of layout.people) {
			if (Math.abs(p.y - row) < EPSILON && p.x > lo && p.x < hi && !allowed.has(p.id)) {
				violations.push(`${p.id} sits between the children of ${key}`);
			}
		}
	}
	return violations;
}

function ccw(a: Point, b: Point, c: Point): number {
	return (c.y - a.y) * (b.x - a.x) - (b.y - a.y) * (c.x - a.x);
}

function samePoint(a: Point, b: Point): boolean {
	return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
}

function crosses(a: LayoutEdge, b: LayoutEdge): boolean {
	if (
		samePoint(a.source, b.source) ||
		samePoint(a.source, b.target) ||
		samePoint(a.target, b.source) ||
		samePoint(a.target, b.target)
	) {
		return false;
	}
	const d1 = ccw(a.source, a.target, b.source);
	const d2 = ccw(a.source, a.target, b.target);
	const d3 = ccw(b.source, b.target, a.source);
	const d4 = ccw(b.source, b.target, a.target);
	return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Straight-line crossings between edge centres; the metric the baseline file records. */
export function countCrossings(layout: TreeLayout): number {
	let count = 0;
	for (let i = 0; i < layout.edges.length; i++) {
		for (let j = i + 1; j < layout.edges.length; j++) {
			if (crosses(layout.edges[i], layout.edges[j])) count++;
		}
	}
	return count;
}

/**
 * No two edges run between the same two points: that is what "stacked duplicate edges" looks
 * like on screen, whatever the edges' ids say.
 */
export function findStackedEdges(layout: TreeLayout): string[] {
	const violations: string[] = [];
	const seen = new Map<string, string>();
	for (const e of layout.edges) {
		const a = `${e.source.x},${e.source.y}`;
		const b = `${e.target.x},${e.target.y}`;
		const key = a < b ? `${a}>${b}` : `${b}>${a}`;
		const other = seen.get(key);
		if (other) violations.push(`edges ${other} and ${e.id} are stacked`);
		else seen.set(key, e.id);
	}
	return violations;
}

/** Row consistency: y follows the generation, every row is a fixed distance apart. */
export function findRowViolations(layout: TreeLayout, m: LayoutMetrics = LAYOUT_METRICS): string[] {
	return layout.people
		.filter((p) => Math.abs(p.y - p.generation * m.rowHeight) > EPSILON)
		.map((p) => `${p.id} is not on row ${p.generation}`);
}

export function allContractViolations(
	graph: RelationshipGraph,
	layout: TreeLayout,
	m: LayoutMetrics = LAYOUT_METRICS
): string[] {
	return [
		...findDuplicatePeople(layout),
		...findDuplicateUnions(layout),
		...findOverlaps(layout, m),
		...findMissingPartners(graph, layout),
		...findPartnerViolations(layout, m),
		...findEdgeViolations(graph, layout),
		...findStackedEdges(layout),
		...findCentringViolations(layout),
		...findRowViolations(layout, m)
	];
}
