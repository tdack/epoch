import { describe, expect, it } from 'vitest';
import { POSTER_MARGIN_MM, POSTER_MM_PER_UNIT, posterSheet } from './poster';

describe('the poster sheet', () => {
	it('prints a tree at readable size on a sheet cut to fit it', () => {
		const sheet = posterSheet({ minX: 0, minY: 0, maxX: 3940, maxY: 1940 });
		expect(sheet.cardWidthMm).toBe(210 * POSTER_MM_PER_UNIT);
		expect(sheet.drawingWidthMm).toBe(1000);
		expect(sheet.widthMm).toBe(1000 + 2 * POSTER_MARGIN_MM);
		expect(sheet.heightMm).toBe(500 + 2 * POSTER_MARGIN_MM);
		expect(sheet.viewBox).toBe('-30 -30 4000 2000');
	});

	it('shrinks a tree too big for A0 onto A0, turned to suit its shape', () => {
		const wide = posterSheet({ minX: 0, minY: 0, maxX: 20_000, maxY: 2_000 });
		expect(wide.widthMm).toBeLessThanOrEqual(1189);
		expect(wide.heightMm).toBeLessThanOrEqual(841);
		expect(wide.cardWidthMm).toBeLessThan(210 * POSTER_MM_PER_UNIT);
		const tall = posterSheet({ minX: 0, minY: 0, maxX: 2_000, maxY: 20_000 });
		expect(tall.widthMm).toBeLessThanOrEqual(841);
		expect(tall.heightMm).toBeLessThanOrEqual(1189);
	});

	it('never goes below A4', () => {
		const sheet = posterSheet({ minX: 0, minY: 0, maxX: 210, maxY: 74 });
		expect([sheet.widthMm, sheet.heightMm]).toEqual([297, 210]);
	});
});
