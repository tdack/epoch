import { describe, expect, it } from 'vitest';
import { distanceKm } from './distance';

const MELBOURNE = { latitude: -37.8136, longitude: 144.9631 };
const BALLARAT = { latitude: -37.5622, longitude: 143.8503 };

describe('distanceKm', () => {
	it('is about 105 km from Melbourne to Ballarat', () => {
		expect(distanceKm(MELBOURNE, BALLARAT)).toBeGreaterThan(100);
		expect(distanceKm(MELBOURNE, BALLARAT)).toBeLessThan(110);
	});

	it('is the same in either direction and zero for the same point', () => {
		expect(distanceKm(BALLARAT, MELBOURNE)).toBeCloseTo(distanceKm(MELBOURNE, BALLARAT), 9);
		expect(distanceKm(MELBOURNE, MELBOURNE)).toBe(0);
	});

	it('is half the Earth’s circumference between opposite points', () => {
		expect(distanceKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 180 })).toBeCloseTo(
			20015.09,
			0
		);
	});

	it('does not go wrong across the antimeridian', () => {
		expect(
			distanceKm({ latitude: 0, longitude: 179.9 }, { latitude: 0, longitude: -179.9 })
		).toBeCloseTo(22.2, 0);
	});
});
