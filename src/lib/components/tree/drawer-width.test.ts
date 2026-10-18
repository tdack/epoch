import { describe, expect, it } from 'vitest';
import {
	DRAWER_MIN_WIDTH_PX,
	canResizeDrawer,
	clampDrawerWidth,
	maxDrawerWidth
} from './drawer-width.js';

describe('clampDrawerWidth', () => {
	it('never goes below the original fixed width', () => {
		expect(clampDrawerWidth(200, 1440)).toBe(DRAWER_MIN_WIDTH_PX);
	});

	it('leaves part of the canvas showing', () => {
		expect(clampDrawerWidth(5000, 1440)).toBe(maxDrawerWidth(1440));
		expect(maxDrawerWidth(1440)).toBeLessThan(1440);
	});

	it('shrinks a remembered width to fit a smaller window', () => {
		expect(clampDrawerWidth(900, 1024)).toBe(maxDrawerWidth(1024));
	});

	it('treats an unreadable stored value as the minimum', () => {
		expect(clampDrawerWidth(Number.NaN, 1440)).toBe(DRAWER_MIN_WIDTH_PX);
	});
});

describe('canResizeDrawer', () => {
	it('is offered on desktop widths', () => {
		expect(canResizeDrawer(1280)).toBe(true);
	});

	it('is withheld on phones and small tablets', () => {
		expect(canResizeDrawer(390)).toBe(false);
		expect(canResizeDrawer(700)).toBe(false);
	});
});
