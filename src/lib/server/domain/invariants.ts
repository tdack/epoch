/**
 * Pure business invariants for the Phase 1 genealogy model.
 *
 * These functions validate a proposed mutation against the current graph state
 * and return typed violations. They are pure (no I/O) so they can be unit
 * tested and reused by both the service layer and import validation.
 */

import type { ParentChild, ParentChildType } from './genealogy-model';

export interface ParentChildInput {
	parentId: string;
	childId: string;
	type: ParentChildType;
	unionId: string | null;
}

export interface InvariantViolation {
	code:
		| 'SELF_PARENTAGE'
		| 'DUPLICATE_ASSERTION'
		| 'CROSS_TREE_LINK'
		| 'CYCLE'
		| 'MISSING_PARENT'
		| 'MISSING_CHILD';
	message: string;
}

/**
 * Validate a proposed parent-child assertion against existing assertions.
 *
 * `existing` is the set of already-persisted assertions for the same tree, and
 * `treeId` is the tree the new assertion belongs to. `allParentChild` is the
 * full set of assertions used to detect cycles.
 */
export function validateParentChildAssertion(
	input: ParentChildInput,
	treeId: string,
	existing: ParentChild[],
	allParentChild: ParentChild[]
): InvariantViolation[] {
	const violations: InvariantViolation[] = [];

	if (!input.parentId) {
		violations.push({ code: 'MISSING_PARENT', message: 'A parent is required' });
	}
	if (!input.childId) {
		violations.push({ code: 'MISSING_CHILD', message: 'A child is required' });
	}
	if (input.parentId && input.parentId === input.childId) {
		violations.push({ code: 'SELF_PARENTAGE', message: 'A person cannot be their own parent' });
	}

	// Duplicate identical assertion: same parent, child and type.
	const duplicate = existing.some(
		(a) => a.parentId === input.parentId && a.childId === input.childId && a.type === input.type
	);
	if (duplicate) {
		violations.push({
			code: 'DUPLICATE_ASSERTION',
			message: 'This parent-child assertion already exists'
		});
	}

	// Cross-tree links are detected by the caller passing only same-tree rows;
	// this guard is a defensive check for callers that pass a mixed set.
	const crossTree = existing.some((a) => a.treeId !== treeId);
	if (crossTree) {
		violations.push({
			code: 'CROSS_TREE_LINK',
			message: 'Parent-child assertions cannot span trees'
		});
	}

	// Cycle detection: adding parent -> child must not create a path from child
	// back to parent through existing assertions.
	if (input.parentId && input.childId && input.parentId !== input.childId) {
		if (hasPath(input.childId, input.parentId, allParentChild)) {
			violations.push({
				code: 'CYCLE',
				message: 'This assertion would create a cycle in the ancestry graph'
			});
		}
	}

	return violations;
}

/**
 * Return true when there is a directed path from `from` to `to` following
 * parent -> child edges.
 */
export function hasPath(from: string, to: string, assertions: ParentChild[]): boolean {
	const childrenByParent = new Map<string, string[]>();
	for (const a of assertions) {
		const list = childrenByParent.get(a.parentId) ?? [];
		list.push(a.childId);
		childrenByParent.set(a.parentId, list);
	}

	const visited = new Set<string>();
	const stack = [from];
	while (stack.length > 0) {
		const current = stack.pop()!;
		if (current === to) return true;
		if (visited.has(current)) continue;
		visited.add(current);
		for (const child of childrenByParent.get(current) ?? []) {
			stack.push(child);
		}
	}
	return false;
}