import type { GraphIndex } from './graph-index.js';
import type {
	ChildAssertion,
	ChildEdge,
	FocusSelection,
	LayoutEdge,
	PartnerEdge,
	PlacedPerson,
	PlacedStub,
	PlacedUnion,
	StubEdge
} from './types.js';

function assertionsOf(entries: Array<{ parentId: string; type: ChildAssertion['type'] }>): ChildAssertion[] {
	const seen = new Set<string>();
	const out: ChildAssertion[] = [];
	for (const { parentId, type } of entries) {
		const key = `${parentId}|${type}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ parentId, type });
	}
	return out;
}

/**
 * One partner edge per (union, partner) and one child edge per (union, child), however many
 * per-parent assertions sit behind it. Parent-child links with no union get one edge per
 * (parent, child).
 */
export function buildEdges(
	index: GraphIndex,
	selection: FocusSelection,
	people: Map<string, PlacedPerson>,
	unions: Map<string, PlacedUnion>,
	stubs: PlacedStub[],
	primaryEdgeKeys: Set<string>,
	directLinks: Array<{ parentId: string; childId: string; type: ChildAssertion['type'] }>
): LayoutEdge[] {
	const partnerEdges: PartnerEdge[] = [];
	const childEdges: ChildEdge[] = [];

	for (const { id: unionId } of selection.unions) {
		const placed = unions.get(unionId);
		const union = index.unionById.get(unionId);
		if (!placed || !union) continue;

		for (const partnerId of new Set(union.partnerIds)) {
			const person = people.get(partnerId);
			if (!person) continue;
			partnerEdges.push({
				kind: 'partner',
				id: `partner:${unionId}:${partnerId}`,
				unionId,
				personId: partnerId,
				source: { x: person.x, y: person.y },
				target: { x: placed.x, y: placed.y }
			});
		}

		const byChild = new Map<string, Array<{ parentId: string; type: ChildAssertion['type'] }>>();
		for (const c of union.children) {
			byChild.set(c.childId, [...(byChild.get(c.childId) ?? []), { parentId: c.parentId, type: c.type }]);
		}
		for (const [childId, entries] of byChild) {
			const child = people.get(childId);
			if (!child) continue;
			const assertions = assertionsOf(entries);
			childEdges.push({
				kind: 'child',
				id: `child:${unionId}:${childId}`,
				unionId,
				childId,
				assertions,
				types: [...new Set(assertions.map((a) => a.type))].sort(),
				isSecondaryPath: !primaryEdgeKeys.has(`${unionId}|${childId}`),
				source: { x: placed.x, y: placed.y },
				target: { x: child.x, y: child.y }
			});
		}
	}

	const directByPair = new Map<string, Array<{ parentId: string; type: ChildAssertion['type'] }>>();
	for (const link of directLinks) {
		if (!people.has(link.parentId) || !people.has(link.childId)) continue;
		const key = `${link.parentId}|${link.childId}`;
		directByPair.set(key, [...(directByPair.get(key) ?? []), { parentId: link.parentId, type: link.type }]);
	}
	for (const [key, entries] of directByPair) {
		const [parentId, childId] = key.split('|');
		const parent = people.get(parentId)!;
		const child = people.get(childId)!;
		const assertions = assertionsOf(entries);
		childEdges.push({
			kind: 'child',
			id: `direct:${parentId}:${childId}`,
			unionId: null,
			childId,
			assertions,
			types: [...new Set(assertions.map((a) => a.type))].sort(),
			isSecondaryPath: !primaryEdgeKeys.has(`direct|${parentId}|${childId}`),
			source: { x: parent.x, y: parent.y },
			target: { x: child.x, y: child.y }
		});
	}

	const stubEdges: StubEdge[] = [];
	for (const stub of stubs) {
		const person = people.get(stub.personId);
		const union = stub.unionId ? unions.get(stub.unionId) : undefined;
		if (stub.kind === 'ancestors') {
			if (!person) continue;
			stubEdges.push({
				kind: 'stub',
				id: `stub-edge:${stub.id}`,
				stubId: stub.id,
				source: { x: stub.x, y: stub.y },
				target: { x: person.x, y: person.y }
			});
		} else {
			const from = union ?? person;
			if (!from) continue;
			stubEdges.push({
				kind: 'stub',
				id: `stub-edge:${stub.id}`,
				stubId: stub.id,
				source: { x: from.x, y: from.y },
				target: { x: stub.x, y: stub.y }
			});
		}
	}

	return [...partnerEdges, ...childEdges, ...stubEdges];
}
