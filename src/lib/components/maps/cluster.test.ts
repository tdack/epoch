import { describe, expect, it } from 'vitest';
import { clusterPoints, mercatorPixels } from './cluster';

const cork = { latitude: 51.9, longitude: -8.47 };
const nearCork = { latitude: 51.91, longitude: -8.46 };
const hobart = { latitude: -42.88, longitude: 147.33 };

describe('clusterPoints', () => {
	it('joins places that share a screen cell and sits the cluster among them', () => {
		const clusters = clusterPoints([cork, nearCork, hobart], 4);
		expect(clusters).toHaveLength(2);
		const joined = clusters.find((c) => c.members.length === 2)!;
		expect(joined.latitude).toBeCloseTo(51.905);
		expect(joined.longitude).toBeCloseTo(-8.465);
	});

	it('splits the same places as the viewer zooms in', () => {
		expect(clusterPoints([cork, nearCork], 4)).toHaveLength(1);
		expect(clusterPoints([cork, nearCork], 16)).toHaveLength(2);
	});

	it('keeps every point exactly once and handles none', () => {
		expect(clusterPoints([], 3)).toEqual([]);
		const clusters = clusterPoints([cork, nearCork, hobart], 2);
		expect(clusters.flatMap((c) => c.members)).toHaveLength(3);
	});
});

describe('mercatorPixels', () => {
	it('puts the origin of the world at the left edge and the equator in the middle', () => {
		expect(mercatorPixels(0, -180, 0)).toEqual({ x: 0, y: 128 });
		expect(mercatorPixels(0, 0, 1).x).toBe(256);
	});
});
