import type { ParentChildType, RelationshipGraph } from './types.js';

/**
 * A copy of the graph keeping only parent-child assertions of the given types. Unions and
 * partners are untouched, so a couple is never split by a filter; a child whose only links are
 * filtered out simply has no drawn parents.
 */
export function filterParentChildTypes(
	graph: RelationshipGraph,
	allowedTypes: readonly ParentChildType[]
): RelationshipGraph {
	const allowed = new Set(allowedTypes);
	return {
		people: graph.people.map((person) => {
			const parentsByUnion: typeof person.parentsByUnion = {};
			for (const [key, parents] of Object.entries(person.parentsByUnion)) {
				const kept = parents.filter((p) => allowed.has(p.type));
				if (kept.length > 0) parentsByUnion[key] = kept;
			}
			return { ...person, parentsByUnion };
		}),
		unions: graph.unions.map((union) => ({
			...union,
			children: union.children.filter((c) => allowed.has(c.type))
		})),
		parentChild: graph.parentChild.filter((pc) => allowed.has(pc.type))
	};
}
