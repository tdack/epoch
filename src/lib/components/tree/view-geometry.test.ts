import { describe, expect, it } from 'vitest';
import { chooseFitAction, isNearTransform, markerLabel, offscreenMarkers } from './view-geometry';

const size = { width: 400, height: 600 };
const card = { width: 100, height: 50 };
const identity = { x: 0, y: 0, k: 1 };

describe('offscreenMarkers', () => {
	it('reports nothing when every card shows', () => {
		expect(offscreenMarkers([{ x: 200, y: 300 }], identity, size, card)).toEqual([]);
	});

	it('counts a card wholly outside, and ignores one that still shows a sliver', () => {
		const people = [
			{ x: 480, y: 300 }, // left edge at 430: wholly right of the 400px view
			{ x: 440, y: 300 } // left edge at 390: ten pixels show, so the marker steps below it
		];
		expect(offscreenMarkers(people, identity, size, card)).toEqual([
			{ direction: 'right', count: 1, pan: { x: 200 - 480, y: 0 }, offset: 354 }
		]);
	});

	it('groups by edge in a fixed order and pans toward the nearest of each group', () => {
		const people = [
			{ x: 900, y: 300 },
			{ x: 600, y: 300 },
			{ x: -300, y: 300 },
			{ x: 200, y: 900 }
		];
		const markers = offscreenMarkers(people, identity, size, card);
		expect(markers.map((m) => [m.direction, m.count])).toEqual([
			['left', 1],
			['right', 2],
			['down', 1]
		]);
		expect(markers[1].pan).toEqual({ x: 200 - 600, y: 0 });
		expect(markers[2].pan).toEqual({ x: 0, y: 300 - 900 });
	});

	it('follows the pan and the zoom', () => {
		const people = [{ x: 1000, y: 100 }];
		expect(offscreenMarkers(people, { x: -800, y: 0, k: 1 }, size, card)).toEqual([]);
		// At a tenth of the scale the same person is near the origin.
		expect(offscreenMarkers(people, { x: 0, y: 0, k: 0.1 }, size, card)).toEqual([]);
	});

	it('counts a corner card once, on the axis it overshoots most', () => {
		const people = [{ x: 500, y: 1500 }];
		const markers = offscreenMarkers(people, identity, size, card);
		expect(markers).toHaveLength(1);
		expect(markers[0].direction).toBe('down');
		// Outside on both axes, so the pan brings it in on both.
		expect(markers[0].pan).toEqual({ x: 200 - 500, y: 300 - 1500 });
	});

	it('leaves the side marker at mid-height when no card shows beside that edge', () => {
		const markers = offscreenMarkers([{ x: 600, y: 300 }], identity, size, card);
		expect(markers[0].offset).toBe(300);
	});

	it('moves a side marker off a card that shows beside its edge', () => {
		const people = [
			{ x: 600, y: 300 }, // off to the right
			{ x: 340, y: 300 } // on screen, spanning x 290 to 390 and y 275 to 325
		];
		const marker = offscreenMarkers(people, identity, size, card).find(
			(m) => m.direction === 'right'
		);
		const offset = marker!.offset!;
		// The marker needs 52px along the edge; none of it may fall on the card's 275..325.
		expect(offset - 26).toBeGreaterThanOrEqual(325);
	});

	it('ignores cards that are not near the marker edge', () => {
		const people = [
			{ x: 600, y: 300 },
			{ x: 150, y: 300 } // spans x 100 to 200, well clear of the right edge band
		];
		const marker = offscreenMarkers(people, identity, size, card).find(
			(m) => m.direction === 'right'
		);
		expect(marker!.offset).toBe(300);
	});

	it('breaks a tie toward the horizontal axis', () => {
		const people = [{ x: 600, y: 775 }]; // overshoots by 150 right and 150 below
		expect(offscreenMarkers(people, identity, size, card)[0].direction).toBe('right');
	});
});

describe('markerLabel', () => {
	it('names the count, the side and the action', () => {
		expect(markerLabel({ direction: 'right', count: 3 })).toBe(
			'3 relatives to the right, show them'
		);
		expect(markerLabel({ direction: 'left', count: 1 })).toBe('1 relative to the left, show them');
		expect(markerLabel({ direction: 'up', count: 2 })).toBe('2 relatives above, show them');
		expect(markerLabel({ direction: 'down', count: 2 })).toBe('2 relatives below, show them');
	});
});

describe('chooseFitAction', () => {
	it('is always the whole tree where that stays readable', () => {
		expect(chooseFitAction({ isWholeUnreadable: false, isAtFrame: false })).toBe('whole');
		expect(chooseFitAction({ isWholeUnreadable: false, isAtFrame: true })).toBe('whole');
	});

	it('goes to the readable framing first, then to the whole tree', () => {
		expect(chooseFitAction({ isWholeUnreadable: true, isAtFrame: false })).toBe('frame');
		expect(chooseFitAction({ isWholeUnreadable: true, isAtFrame: true })).toBe('whole');
	});
});

describe('isNearTransform', () => {
	const base = { x: 100, y: 50, k: 0.5 };

	it('forgives a nudge and a hair of zoom', () => {
		expect(isNearTransform({ x: 108, y: 44, k: 0.505 }, base)).toBe(true);
	});

	it('does not forgive a real pan or zoom', () => {
		expect(isNearTransform({ x: 140, y: 50, k: 0.5 }, base)).toBe(false);
		expect(isNearTransform({ x: 100, y: 50, k: 0.24 }, base)).toBe(false);
	});
});
