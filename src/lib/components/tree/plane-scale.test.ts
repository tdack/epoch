import { describe, expect, it } from 'vitest';
import { foldWideRows, isBoxInView, rowKeyOf, type FoldItem } from './plane-scale';

const size = { width: 1000, height: 600 };
const box = (minX: number, maxX: number, minY = 0, maxY = 100) => ({ minX, maxX, minY, maxY });

describe('isBoxInView', () => {
	const identity = { x: 0, y: 0, k: 1 };

	it('keeps a plane that reaches the canvas and drops one that is clear of it', () => {
		expect(isBoxInView(box(100, 400), identity, size, 0)).toBe(true);
		expect(isBoxInView(box(1200, 1500), identity, size, 0)).toBe(false);
		expect(isBoxInView(box(0, 100, 900, 1000), identity, size, 0)).toBe(false);
	});

	it('follows the pan and the zoom', () => {
		expect(isBoxInView(box(1200, 1500), { x: -900, y: 0, k: 1 }, size, 0)).toBe(true);
		// Zoomed out to a tenth, a box far to the right shrinks toward the origin and comes into view.
		expect(isBoxInView(box(5000, 6000), { x: 0, y: 0, k: 0.1 }, size, 0)).toBe(true);
	});

	it('lets a plane mount a margin early', () => {
		expect(isBoxInView(box(1100, 1300), identity, size, 0)).toBe(false);
		expect(isBoxInView(box(1100, 1300), identity, size, 200)).toBe(true);
	});
});

describe('foldWideRows', () => {
	const row = (group: number, count: number, generation = 0): FoldItem[] =>
		Array.from({ length: count }, (_, i) => ({
			id: `g${group}-${i}`,
			group,
			generation,
			x: i * 100
		}));
	const open = new Set<string>();
	const none = new Set<string>();

	it('leaves rows that fit, the direct line and opened rows alone', () => {
		const items = [...row(0, 30), ...row(1, 5), ...row(2, 30, 1)];
		const opened = new Set([rowKeyOf(2, 1)]);
		const result = foldWideRows(items, {
			limit: 10,
			centreX: 0,
			protectedIds: none,
			openRowKeys: opened
		});
		expect(result.hiddenIds.size).toBe(0);
		expect(result.marks).toEqual([]);
	});

	it('keeps the cards nearest the centre and folds each run of the rest into one mark', () => {
		const items = row(1, 14);
		const { hiddenIds, marks } = foldWideRows(items, {
			limit: 6,
			centreX: 650,
			protectedIds: none,
			openRowKeys: open
		});
		// Kept: x 400..900 (the six nearest 650). Folded: 0..300 on the left, 1000..1300 on the right.
		expect([...hiddenIds].sort()).toEqual(
			['g1-0', 'g1-1', 'g1-2', 'g1-3', 'g1-10', 'g1-11', 'g1-12', 'g1-13'].sort()
		);
		expect(marks.map((m) => [m.x, m.count])).toEqual([
			[150, 4],
			[1150, 4]
		]);
		expect(marks.every((m) => m.rowKey === rowKeyOf(1, 0))).toBe(true);
	});

	it('never folds a protected card, even a far one, and the mark splits around it', () => {
		const { hiddenIds, marks } = foldWideRows(row(1, 14), {
			limit: 4,
			centreX: 0,
			protectedIds: new Set(['g1-9']),
			openRowKeys: open
		});
		expect(hiddenIds.has('g1-9')).toBe(false);
		// The run to the right of the nearest cards is cut in two by the protected card.
		expect(marks.length).toBe(2);
		expect(marks.reduce((n, m) => n + m.count, 0)).toBe(hiddenIds.size);
	});

	it('is the same on every call for the same input', () => {
		const args = { limit: 5, centreX: 300, protectedIds: none, openRowKeys: open };
		const a = foldWideRows(row(2, 20), args);
		const b = foldWideRows([...row(2, 20)].reverse(), args);
		expect(b.marks).toEqual(a.marks);
		expect([...b.hiddenIds].sort()).toEqual([...a.hiddenIds].sort());
	});
});
