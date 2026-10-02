import { describe, it, expect } from 'vitest';
import { validateParentChildAssertion, hasPath } from './invariants';
import type { ParentChild } from './genealogy-model';

function assertion(
	overrides: Partial<ParentChild> & { parentId: string; childId: string }
): ParentChild {
	return {
		id: crypto.randomUUID(),
		treeId: 'tree-1',
		type: 'biological',
		status: 'active',
		unionId: null,
		version: 1,
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides
	};
}

describe('validateParentChildAssertion', () => {
	it('accepts a valid assertion', () => {
		const violations = validateParentChildAssertion(
			{ parentId: 'p1', childId: 'c1', type: 'biological', unionId: null },
			'tree-1',
			[],
			[]
		);
		expect(violations).toEqual([]);
	});

	it('rejects self-parentage', () => {
		const violations = validateParentChildAssertion(
			{ parentId: 'p1', childId: 'p1', type: 'biological', unionId: null },
			'tree-1',
			[],
			[]
		);
		expect(violations.some((v) => v.code === 'SELF_PARENTAGE')).toBe(true);
	});

	it('rejects duplicate identical assertions', () => {
		const existing = [assertion({ parentId: 'p1', childId: 'c1', type: 'biological' })];
		const violations = validateParentChildAssertion(
			{ parentId: 'p1', childId: 'c1', type: 'biological', unionId: null },
			'tree-1',
			existing,
			existing
		);
		expect(violations.some((v) => v.code === 'DUPLICATE_ASSERTION')).toBe(true);
	});

	it('allows the same parent-child pair with different types', () => {
		const existing = [assertion({ parentId: 'p1', childId: 'c1', type: 'biological' })];
		const violations = validateParentChildAssertion(
			{ parentId: 'p1', childId: 'c1', type: 'adoptive', unionId: null },
			'tree-1',
			existing,
			existing
		);
		expect(violations).toEqual([]);
	});

	it('rejects cycles', () => {
		// p1 -> c1 -> p1 would be a cycle if we add c1 -> p1.
		const existing = [assertion({ parentId: 'p1', childId: 'c1' })];
		const violations = validateParentChildAssertion(
			{ parentId: 'c1', childId: 'p1', type: 'biological', unionId: null },
			'tree-1',
			[],
			existing
		);
		expect(violations.some((v) => v.code === 'CYCLE')).toBe(true);
	});

	it('rejects missing parent or child', () => {
		const violations = validateParentChildAssertion(
			{ parentId: '', childId: 'c1', type: 'biological', unionId: null },
			'tree-1',
			[],
			[]
		);
		expect(violations.some((v) => v.code === 'MISSING_PARENT')).toBe(true);
	});
});

describe('hasPath', () => {
	it('detects a direct path', () => {
		const edges = [assertion({ parentId: 'a', childId: 'b' })];
		expect(hasPath('a', 'b', edges)).toBe(true);
	});

	it('detects a transitive path', () => {
		const edges = [
			assertion({ parentId: 'a', childId: 'b' }),
			assertion({ parentId: 'b', childId: 'c' })
		];
		expect(hasPath('a', 'c', edges)).toBe(true);
	});

	it('returns false when no path exists', () => {
		const edges = [assertion({ parentId: 'a', childId: 'b' })];
		expect(hasPath('b', 'a', edges)).toBe(false);
	});
});
