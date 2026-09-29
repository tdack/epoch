/**
 * Step relationships, derived from partnerships and never stored (Phase 1). A step-parent is a
 * parent's partner who is not themselves a parent of the child; a step-child is a partner's child
 * (from any partnership) who is not this person's own. Death and separation do not remove them: the record says how the
 * relationship arose, and the partnership's status is shown beside it.
 */

interface GraphLike {
	people: Array<{ id: string; stepParents: Array<{ stepParentId: string; unionId: string }> }>;
	unions: Array<{ id: string; partnerIds: string[] }>;
	parentChild: Array<{ parentId: string; childId: string }>;
}

export interface StepRelatives {
	/** Each step-parent once, with a partnership that makes them one. */
	stepParents: Array<{ personId: string; unionId: string }>;
	/** Each step-child once, with the partner they are a child of. */
	stepChildren: Array<{ personId: string; viaPartnerId: string; unionId: string }>;
}

export function stepRelativesOf(graph: GraphLike, personId: string): StepRelatives {
	const seenParents = new Set<string>();
	const stepParents = (graph.people.find((p) => p.id === personId)?.stepParents ?? [])
		.filter((s) => s.stepParentId !== personId && !seenParents.has(s.stepParentId) && seenParents.add(s.stepParentId))
		.map((s) => ({ personId: s.stepParentId, unionId: s.unionId }));

	const own = new Set(graph.parentChild.filter((l) => l.parentId === personId).map((l) => l.childId));
	const seenChildren = new Set<string>();
	const stepChildren: StepRelatives['stepChildren'] = [];
	for (const union of graph.unions.filter((u) => u.partnerIds.includes(personId))) {
		for (const partnerId of union.partnerIds.filter((id) => id !== personId)) {
			// The partner's children from any partnership, not only this one: a step-child is usually from an earlier one.
			for (const link of graph.parentChild.filter((l) => l.parentId === partnerId)) {
				if (link.childId === personId || own.has(link.childId) || seenChildren.has(link.childId)) continue;
				seenChildren.add(link.childId);
				stepChildren.push({ personId: link.childId, viaPartnerId: partnerId, unionId: union.id });
			}
		}
	}
	return { stepParents, stepChildren };
}
