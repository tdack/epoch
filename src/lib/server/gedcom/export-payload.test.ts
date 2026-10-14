import { describe, expect, it } from 'vitest';
import { withoutTreePrefix } from './export-payload';

describe('withoutTreePrefix', () => {
	it('strips the tree prefix from an id', () => {
		expect(withoutTreePrefix('tree1:I1', 'tree1')).toBe('I1');
	});

	it('leaves an id without the prefix unchanged', () => {
		expect(withoutTreePrefix('I1', 'tree1')).toBe('I1');
		expect(withoutTreePrefix('other:I1', 'tree1')).toBe('other:I1');
	});

	it('treats a dot in the tree id as a literal dot, not a wildcard', () => {
		expect(withoutTreePrefix('axb:I1', 'a.b')).toBe('axb:I1');
		expect(withoutTreePrefix('a.b:I1', 'a.b')).toBe('I1');
	});

	it('does not hang on a tree id that would be a backtracking pattern as a RegExp', () => {
		const treeId = '(a+)+';
		const id = `${'a'.repeat(40)}!`;
		expect(withoutTreePrefix(id, treeId)).toBe(id);
		expect(withoutTreePrefix(`${treeId}:I1`, treeId)).toBe('I1');
	});
});
