/**
 * The whole tree as a selection: everyone the viewer may see, not anchored to anyone. It has the
 * shape `selectFocusSubgraph` returns (with `focusPersonId: null`) so the four WebGL layouts draw
 * it without a second code path.
 *
 * Rows are global. A child is one row below its lowest parent, partners share a row, and the
 * oldest row is 0. Families with no recorded link between them are separate components; each is
 * laid out from its own row 0, then slid to line up by birth era with the largest component where
 * both have dated people, and left at row 0 where they do not.
 */

import {
	DEFAULT_FOCUS_OPTIONS,
	PERSON_ROLES,
	type RelationshipGraph,
	type SelectedPerson,
	type SelectedUnion,
	type TreeSelection
} from './types.js';

/** How many years one row stands for when lining up families that share no link. */
export const YEARS_PER_GENERATION = 30;

function firstYear(text: string | null | undefined): number | null {
	const match = text?.match(/\b(\d{4})\b/);
	return match ? Number(match[1]) : null;
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Selects every person the graph fully holds. People a bounded window only names (`isPartial`) are
 * skipped: their relatives are incomplete, so a row computed from them would be wrong.
 *
 * Bad data: a parent loop (A is B's parent and B is A's) cannot have rows that put every child
 * below its parent. The walk then takes the earliest person in the graph's own order out of the
 * loop, gives them the row below their placed parents, and carries on, so the same graph always
 * draws the same way. A partner who is also the other's parent is treated as the same row.
 */
export function selectWholeTree(graph: RelationshipGraph): TreeSelection {
	const people = graph.people.filter((p) => p.isPartial !== true);
	const order = new Map(people.map((p, i) => [p.id, i]));
	const isDrawn = (id: string) => order.has(id);

	// Partners share a row, so a partnership is one node for the purposes of rows.
	const parent = new Map(people.map((p) => [p.id, p.id]));
	const find = (id: string): string => {
		let root = id;
		while (parent.get(root) !== root) root = parent.get(root)!;
		for (let cursor = id; cursor !== root;) {
			const next = parent.get(cursor)!;
			parent.set(cursor, root);
			cursor = next;
		}
		return root;
	};
	const join = (a: string, b: string) => {
		const ra = find(a);
		const rb = find(b);
		// The earlier person stays the root, so the node's identity does not depend on union order.
		if (ra !== rb) {
			if (order.get(ra)! <= order.get(rb)!) parent.set(rb, ra);
			else parent.set(ra, rb);
		}
	};
	const drawnUnions = graph.unions.filter((u) => u.partnerIds.some(isDrawn));
	for (const union of drawnUnions) {
		const partners = union.partnerIds.filter(isDrawn);
		for (const id of partners.slice(1)) join(partners[0], id);
	}

	const parentsOfNode = new Map<string, Set<string>>();
	const childrenOfNode = new Map<string, Set<string>>();
	const addEdge = (parentId: string, childId: string) => {
		if (!isDrawn(parentId) || !isDrawn(childId)) return;
		const from = find(parentId);
		const to = find(childId);
		if (from === to) return;
		if (!parentsOfNode.has(to)) parentsOfNode.set(to, new Set());
		if (!childrenOfNode.has(from)) childrenOfNode.set(from, new Set());
		parentsOfNode.get(to)!.add(from);
		childrenOfNode.get(from)!.add(to);
	};
	for (const link of graph.parentChild) addEdge(link.parentId, link.childId);

	const nodes = [...new Set(people.map((p) => find(p.id)))].sort(
		(a, b) => order.get(a)! - order.get(b)!
	);
	const waiting = new Map(nodes.map((n) => [n, parentsOfNode.get(n)?.size ?? 0]));
	const rowOf = new Map<string, number>();
	const ready = nodes.filter((n) => waiting.get(n) === 0);
	const settle = (node: string, row: number) => {
		rowOf.set(node, row);
		for (const child of childrenOfNode.get(node) ?? []) {
			waiting.set(child, waiting.get(child)! - 1);
			if (waiting.get(child) === 0 && !rowOf.has(child)) ready.push(child);
		}
	};
	const rowBelowParents = (node: string) => {
		let row = -1;
		for (const p of parentsOfNode.get(node) ?? []) row = Math.max(row, rowOf.get(p) ?? -1);
		return row + 1;
	};
	// Longest path from the roots (Kahn's algorithm): a child sits below its lowest parent.
	while (rowOf.size < nodes.length) {
		while (ready.length > 0) {
			const node = ready.shift()!;
			if (rowOf.has(node)) continue;
			settle(node, rowBelowParents(node));
		}
		const stuck = nodes.find((n) => !rowOf.has(n));
		if (stuck !== undefined) settle(stuck, rowBelowParents(stuck));
	}

	// Components: nodes joined by any parent-child edge, ignoring direction.
	const componentOf = new Map<string, number>();
	let componentCount = 0;
	for (const start of nodes) {
		if (componentOf.has(start)) continue;
		const stack = [start];
		componentOf.set(start, componentCount);
		while (stack.length > 0) {
			const node = stack.pop()!;
			for (const next of [...(parentsOfNode.get(node) ?? []), ...(childrenOfNode.get(node) ?? [])])
				if (!componentOf.has(next)) {
					componentOf.set(next, componentCount);
					stack.push(next);
				}
		}
		componentCount++;
	}
	const offsetOf = alignComponents(people, find, rowOf, componentOf, componentCount);

	const generationOf = new Map(
		people.map((p) => [
			p.id,
			rowOf.get(find(p.id))! + (offsetOf.get(componentOf.get(find(p.id))!) ?? 0)
		])
	);
	const lowest = Math.min(0, ...generationOf.values());
	const selected: SelectedPerson[] = people.map((p) => ({
		id: p.id,
		generation: generationOf.get(p.id)! - (lowest < 0 ? lowest : 0),
		// No person is the focus or anyone's ancestor here; descendant is the neutral default.
		role: PERSON_ROLES.DESCENDANT,
		band: 0,
		anchorParentId: null,
		isStepChild: false
	}));
	const rowOfPerson = new Map(selected.map((p) => [p.id, p.generation]));
	const unions: SelectedUnion[] = drawnUnions.map((u) => ({
		id: u.id,
		generation: rowOfPerson.get(u.partnerIds.find(isDrawn)!)!
	}));
	return {
		focusPersonId: null,
		options: { ...DEFAULT_FOCUS_OPTIONS },
		people: selected,
		unions,
		stubs: [],
		expansions: [],
		collapsedPersonIds: []
	};
}

/**
 * Row offsets that line up families with no link between them by birth era. The largest component
 * is the reference: its median birth year and median row say what era a row stands for, and every
 * other component with dated people slides so that its own median birth lands on the same era.
 * Components with no dates keep their own row 0.
 */
function alignComponents(
	people: RelationshipGraph['people'],
	find: (id: string) => string,
	rowOf: Map<string, number>,
	componentOf: Map<string, number>,
	componentCount: number
): Map<number, number> {
	const dated = Array.from({ length: componentCount }, () => ({
		years: [] as number[],
		rows: [] as number[],
		size: 0
	}));
	for (const p of people) {
		const component = componentOf.get(find(p.id))!;
		const entry = dated[component];
		entry.size++;
		const year = firstYear(p.birthDate) ?? firstYear(p.deathDate);
		if (year !== null) {
			entry.years.push(year);
			entry.rows.push(rowOf.get(find(p.id))!);
		}
	}
	const offsets = new Map<number, number>();
	if (componentCount < 2) return offsets;
	const reference = dated.reduce((best, c, i) => (c.size > dated[best].size ? i : best), 0);
	const ref = dated[reference];
	if (ref.years.length === 0) return offsets;
	const refYear = median(ref.years);
	const refRow = median(ref.rows);
	dated.forEach((c, i) => {
		if (i === reference || c.years.length === 0) return;
		const targetRow = refRow + (median(c.years) - refYear) / YEARS_PER_GENERATION;
		offsets.set(i, Math.round(targetRow - median(c.rows)));
	});
	return offsets;
}
