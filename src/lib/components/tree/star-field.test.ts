import { describe, expect, it } from 'vitest';
import { starField } from './star-field.js';

describe('starField', () => {
	it('puts every star on the shell', () => {
		const { positions } = starField(200, 3000);
		for (let i = 0; i < 200; i++) {
			const length = Math.hypot(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
			expect(length).toBeCloseTo(3000, 1);
		}
	});

	it('is the same sky for the same seed and a different one for another', () => {
		expect(starField(50, 100, 1).positions).toEqual(starField(50, 100, 1).positions);
		expect(starField(50, 100, 1).positions).not.toEqual(starField(50, 100, 2).positions);
	});

	it('keeps colours dim and never past white', () => {
		const { colours } = starField(500, 100);
		expect(colours).toHaveLength(1500);
		for (const value of colours) {
			expect(value).toBeGreaterThan(0);
			expect(value).toBeLessThanOrEqual(1);
		}
	});

	it('covers both hemispheres', () => {
		const { positions } = starField(300, 100);
		const heights = Array.from({ length: 300 }, (_, i) => positions[i * 3 + 1]);
		expect(Math.max(...heights)).toBeGreaterThan(50);
		expect(Math.min(...heights)).toBeLessThan(-50);
	});
});
