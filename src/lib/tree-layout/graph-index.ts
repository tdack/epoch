import type {
	RelationshipGraph,
	RelationshipGraphPerson,
	RelationshipGraphUnion
} from './types.js';

/**
 * Lookups over a relationship graph, built once per layout. Every list keeps a stable order
 * (union chronology, then input order) so the layout is deterministic for the same input.
 */
export interface GraphIndex {
	personById: Map<string, RelationshipGraphPerson>;
	unionById: Map<string, RelationshipGraphUnion>;
	/** Unions each person is a partner of, in chronological order. */
	unionsOfPerson: Map<string, RelationshipGraphUnion[]>;
	/** Unions a person is a child of, in chronological order. */
	parentUnionIdsOfChild: Map<string, string[]>;
	/** Parents recorded with no union context. */
	directParentIdsOfChild: Map<string, string[]>;
	directChildIdsOfParent: Map<string, string[]>;
	/** Distinct child ids per union, in the order the union lists them. */
	childIdsOfUnion: Map<string, string[]>;
	unionRank: Map<string, number>;
}

function firstYear(text: string | null): number | null {
	const match = text?.match(/\b(\d{4})\b/);
	return match ? Number(match[1]) : null;
}

/**
 * Chronological rank of each union. The graph has no union dates beyond the marriage text, so
 * unions with a year sort by it and the rest keep input order after them; ties keep input order.
 */
export function rankUnions(unions: RelationshipGraphUnion[]): Map<string, number> {
	const keyed = unions.map((u, index) => ({ id: u.id, year: firstYear(u.marriageDate), index }));
	keyed.sort(
		(a, b) =>
			(a.year ?? Number.POSITIVE_INFINITY) - (b.year ?? Number.POSITIVE_INFINITY) ||
			a.index - b.index
	);
	// Infinity - Infinity is NaN, which `||` treats as falsy, so undated pairs fall through to index.
	return new Map(keyed.map((k, rank) => [k.id, rank]));
}

function pushUnique<K>(map: Map<K, string[]>, key: K, value: string): void {
	const list = map.get(key);
	if (!list) map.set(key, [value]);
	else if (!list.includes(value)) list.push(value);
}

export function buildIndex(graph: RelationshipGraph): GraphIndex {
	const unionRank = rankUnions(graph.unions);
	const byRank = (a: string, b: string) => (unionRank.get(a) ?? 0) - (unionRank.get(b) ?? 0);

	const unionById = new Map(graph.unions.map((u) => [u.id, u]));
	const unionsOfPerson = new Map<string, RelationshipGraphUnion[]>();
	for (const u of graph.unions) {
		for (const id of new Set(u.partnerIds)) {
			unionsOfPerson.set(id, [...(unionsOfPerson.get(id) ?? []), u]);
		}
	}
	for (const list of unionsOfPerson.values()) {
		list.sort((a, b) => byRank(a.id, b.id));
	}

	const parentUnionIdsOfChild = new Map<string, string[]>();
	const directParentIdsOfChild = new Map<string, string[]>();
	const directChildIdsOfParent = new Map<string, string[]>();
	for (const pc of graph.parentChild) {
		if (pc.unionId) {
			pushUnique(parentUnionIdsOfChild, pc.childId, pc.unionId);
		} else {
			pushUnique(directParentIdsOfChild, pc.childId, pc.parentId);
			pushUnique(directChildIdsOfParent, pc.parentId, pc.childId);
		}
	}
	for (const list of parentUnionIdsOfChild.values()) list.sort(byRank);

	const childIdsOfUnion = new Map<string, string[]>();
	for (const u of graph.unions) {
		for (const c of u.children) pushUnique(childIdsOfUnion, u.id, c.childId);
	}

	return {
		personById: new Map(graph.people.map((p) => [p.id, p])),
		unionById,
		unionsOfPerson,
		parentUnionIdsOfChild,
		directParentIdsOfChild,
		directChildIdsOfParent,
		childIdsOfUnion,
		unionRank
	};
}
