import { describe, expect, it } from 'vitest';
import { dropIndex, moveItem } from './reorder';

describe('moveItem', () => {
	it('moves forwards and backwards without touching the input', () => {
		const ids = ['a', 'b', 'c', 'd'];
		expect(moveItem(ids, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
		expect(moveItem(ids, 3, 1)).toEqual(['a', 'd', 'b', 'c']);
		expect(ids).toEqual(['a', 'b', 'c', 'd']);
	});

	it('ignores a move that goes nowhere or off the list', () => {
		expect(moveItem(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
		expect(moveItem(['a', 'b'], 1, 2)).toEqual(['a', 'b']);
		expect(moveItem(['a', 'b'], -1, 0)).toEqual(['a', 'b']);
	});
});

describe('dropIndex', () => {
	const centres = [10, 30, 50, 70];
	it('counts the other rows above the dragged centre', () => {
		expect(dropIndex(centres, 0, 10)).toBe(0);
		expect(dropIndex(centres, 0, 55)).toBe(2);
		expect(dropIndex(centres, 3, 0)).toBe(0);
		expect(dropIndex(centres, 1, 200)).toBe(3);
	});
});
