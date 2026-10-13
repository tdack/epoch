import { describe, expect, it } from 'vitest';
import { fitMinimap, fromMinimap, isWholeVisible, toMinimap, visibleRect } from './minimap';

const bounds = { minX: -1000, minY: 0, maxX: 1000, maxY: 500 };

describe('fitMinimap', () => {
	it('keeps the tree’s shape inside the maximum box', () => {
		const frame = fitMinimap(bounds, 200, 120);
		expect(frame.scale).toBeCloseTo(0.1);
		expect(frame.width).toBeCloseTo(200);
		expect(frame.height).toBeCloseTo(50);
	});

	it('pads a thin tree out to a usable box and centres it', () => {
		const frame = fitMinimap({ minX: 0, minY: 0, maxX: 2000, maxY: 74 }, 200, 120);
		expect(frame.height).toBe(48);
		const tree = toMinimap(frame, { x: 0, y: 0, width: 2000, height: 74 });
		expect(tree.y + tree.height / 2).toBeCloseTo(24);
	});
});

describe('the visible rectangle', () => {
	it('inverts the canvas transform', () => {
		expect(visibleRect({ x: 500, y: 100, k: 0.5 }, { width: 1000, height: 600 })).toEqual({
			x: -1000,
			y: -200,
			width: 2000,
			height: 1200
		});
	});

	it('round-trips through minimap pixels', () => {
		const frame = fitMinimap(bounds, 200, 120);
		const rect = toMinimap(frame, { x: 0, y: 250, width: 0, height: 0 });
		const back = fromMinimap(frame, rect.x, rect.y);
		expect(back.x).toBeCloseTo(0);
		expect(back.y).toBeCloseTo(250);
	});

	it('knows when the whole tree is on screen', () => {
		expect(isWholeVisible(bounds, { x: -1100, y: -50, width: 2200, height: 600 })).toBe(true);
		expect(isWholeVisible(bounds, { x: -500, y: 0, width: 1000, height: 500 })).toBe(false);
	});
});
