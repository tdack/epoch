import { describe, expect, it } from 'vitest';
import { clearLabels, labelRank } from './ring-labels';

const box = (id: string, left: number, top: number) => ({ id, left, top, width: 80, height: 18 });
const none = { isHovered: false, isSelected: false };

describe('clearLabels', () => {
	it('keeps the earlier of two overlapping names and every name that is clear', () => {
		expect(clearLabels([box('a', 0, 0), box('b', 40, 10), box('c', 0, 40)])).toEqual(
			new Set(['a', 'c'])
		);
	});

	it('leaves a small gap between names that only touch', () => {
		expect(clearLabels([box('a', 0, 0), box('b', 81, 0)])).toEqual(new Set(['a']));
		expect(clearLabels([box('a', 0, 0), box('b', 83, 0)])).toEqual(new Set(['a', 'b']));
	});

	it('does not let a hidden name hide another', () => {
		// b is covered by a; c overlaps only b, so it shows.
		expect(clearLabels([box('a', 0, 0), box('b', 60, 0), box('c', 120, 0)])).toEqual(
			new Set(['a', 'c'])
		);
	});
});

describe('labelRank', () => {
	it('puts the pointer and the drawer first, then the focus, then the line by distance', () => {
		const ranks = [
			labelRank(null, 6, { isHovered: true, isSelected: false }),
			labelRank('ancestor', -4, { isHovered: false, isSelected: true }),
			labelRank('focus', 0, none),
			labelRank('partner', 0, none),
			labelRank('ancestor', -1, none),
			labelRank('descendant', 2, none),
			labelRank('ancestor', -6, none),
			labelRank(null, 0, none),
			labelRank(null, -3, none)
		];
		expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
	});
});
