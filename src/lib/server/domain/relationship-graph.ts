/**
 * Read-only relationship graph (Phase 2).
 *
 * Consumes neutral-model DTOs (people, names, unions, partners, parent-child
 * assertions, events) and produces a serializable graph that never normalizes
 * away repeated unions or single-parent groups. Parentage is per-parent typed
 * assertions; step relationships are derived from a parent's union; widowhood
 * and deceased markers are derived from death events.
 */

import type { ParentChildType, UnionStatus } from './genealogy-model';

export interface GraphPersonInput {
	id: string;
	givenName: string | null;
	surname: string | null;
	isDeceased: boolean;
}

export interface GraphUnionInput {
	id: string;
	status: UnionStatus;
	partnerIds: string[];
}

export interface GraphParentChildInput {
	parentId: string;
	childId: string;
	type: ParentChildType;
	unionId: string | null;
}

export interface RelationshipGraphPerson {
	id: string;
	displayName: string;
	isDeceased: boolean;
	/** Parents grouped by union context (`__direct__` for none). */
	parentsByUnion: Record<string, Array<{ parentId: string; type: ParentChildType }>>;
	/** Union IDs this person participates in as a partner. */
	unionIds: string[];
	/** Derived step-parent relationships (parent's partner who is not a parent). */
	stepParents: Array<{ stepParentId: string; unionId: string }>;
}

export interface RelationshipGraphUnion {
	id: string;
	status: UnionStatus;
	partnerIds: string[];
	/** Children asserted within this union, with per-parent type. */
	children: Array<{ childId: string; parentId: string; type: ParentChildType }>;
}

export interface RelationshipGraph {
	people: RelationshipGraphPerson[];
	unions: RelationshipGraphUnion[];
	/** Per-parent typed assertions (edges). */
	parentChild: GraphParentChildInput[];
}

function displayName(givenName: string | null, surname: string | null, id: string): string {
	const parts = [givenName, surname].filter(Boolean);
	return parts.length > 0 ? parts.join(' ') : id;
}

/**
 * Build a read-only relationship graph from neutral inputs.
 *
 * Preserves every union and every per-parent assertion. Step parents are
 * derived as: for each of a child's parents, the parent's other union partners
 * who are not already recorded as the child's parents.
 */
export function buildRelationshipGraph(input: {
	people: GraphPersonInput[];
	unions: GraphUnionInput[];
	parentChild: GraphParentChildInput[];
}): RelationshipGraph {
	const personById = new Map(input.people.map((p) => [p.id, p]));
	const unionById = new Map(input.unions.map((u) => [u.id, u]));

	// Group parent-child assertions by union (and by child for lookup).
	const childrenByUnion = new Map<string, Array<{ childId: string; parentId: string; type: ParentChildType }>>();
	const parentsByChild = new Map<string, Array<{ parentId: string; type: ParentChildType; unionId: string | null }>>();
	for (const pc of input.parentChild) {
		const key = pc.unionId ?? '__direct__';
		if (!childrenByUnion.has(key)) childrenByUnion.set(key, []);
		childrenByUnion.get(key)!.push({ childId: pc.childId, parentId: pc.parentId, type: pc.type });

		if (!parentsByChild.has(pc.childId)) parentsByChild.set(pc.childId, []);
		parentsByChild.get(pc.childId)!.push({ parentId: pc.parentId, type: pc.type, unionId: pc.unionId });
	}

	const people: RelationshipGraphPerson[] = input.people.map((p) => {
		const directParents = parentsByChild.get(p.id) ?? [];
		const parentsByUnion: RelationshipGraphPerson['parentsByUnion'] = {};
		for (const pa of directParents) {
			const key = pa.unionId ?? '__direct__';
			if (!parentsByUnion[key]) parentsByUnion[key] = [];
			parentsByUnion[key].push({ parentId: pa.parentId, type: pa.type });
		}

		// Unions the person participates in as a partner.
		const unionIds = input.unions.filter((u) => u.partnerIds.includes(p.id)).map((u) => u.id);

		// Step parents: for each recorded parent, that parent's union partners
		// (in other unions) who are not themselves recorded parents of p.
		const recordedParentIds = new Set(directParents.map((pa) => pa.parentId));
		const stepParents: RelationshipGraphPerson['stepParents'] = [];
		for (const pa of directParents) {
			const parent = personById.get(pa.parentId);
			if (!parent) continue;
			const parentUnions = input.unions.filter((u) => u.partnerIds.includes(pa.parentId));
			for (const u of parentUnions) {
				for (const partnerId of u.partnerIds) {
					if (partnerId !== pa.parentId && !recordedParentIds.has(partnerId)) {
						stepParents.push({ stepParentId: partnerId, unionId: u.id });
					}
				}
			}
		}

		return {
			id: p.id,
			displayName: displayName(p.givenName, p.surname, p.id),
			isDeceased: p.isDeceased,
			parentsByUnion,
			unionIds,
			stepParents
		};
	});

	const unions: RelationshipGraphUnion[] = input.unions.map((u) => ({
		id: u.id,
		status: u.status,
		partnerIds: u.partnerIds,
		children: childrenByUnion.get(u.id) ?? []
	}));

	return {
		people,
		unions,
		parentChild: input.parentChild
	};
}

/** True when a union is separated/divorced/annulled/ended (for legend markers). */
export function isEndedUnionStatus(status: UnionStatus): boolean {
	return status === 'separated' || status === 'divorced' || status === 'annulled' || status === 'ended';
}
