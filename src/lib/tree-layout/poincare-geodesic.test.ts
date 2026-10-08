import { describe, expect, it } from 'vitest';
import { geodesicPoints, type Vec3 } from './poincare-geodesic';

const norm = (p: Vec3) => Math.hypot(...p);

describe('geodesicPoints', () => {
	it('runs from a to b and stays inside the unit ball', () => {
		const a: Vec3 = [0.8, 0.1, 0];
		const b: Vec3 = [-0.3, -0.6, 0.5];
		const points = geodesicPoints(a, b, 20);
		expect(points[0]).toEqual(a);
		expect(points[20]).toEqual(b);
		for (const p of points) expect(norm(p)).toBeLessThan(1);
	});

	it('bows towards the centre compared with the straight chord', () => {
		const a: Vec3 = [0.9, 0, 0];
		const b: Vec3 = [0, 0.9, 0];
		const mid = geodesicPoints(a, b, 20)[10];
		expect(norm(mid)).toBeLessThan(norm([0.45, 0.45, 0]));
	});

	it('is a straight line through the centre when the points are collinear with it', () => {
		const points = geodesicPoints([0.5, 0, 0], [-0.5, 0, 0], 4);
		expect(points[2][0]).toBeCloseTo(0);
		expect(points[1][1]).toBeCloseTo(0);
	});

	it('lies on a circle orthogonal to the unit sphere', () => {
		const points = geodesicPoints([0.7, 0.2, 0], [-0.1, 0.8, 0], 40);
		const [p, q, r] = [points[0], points[20], points[40]];
		// Circumcentre of three points in the z = 0 plane.
		const d = 2 * (p[0] * (q[1] - r[1]) + q[0] * (r[1] - p[1]) + r[0] * (p[1] - q[1]));
		const sq = (v: Vec3) => v[0] ** 2 + v[1] ** 2;
		const ux = (sq(p) * (q[1] - r[1]) + sq(q) * (r[1] - p[1]) + sq(r) * (p[1] - q[1])) / d;
		const uy = (sq(p) * (r[0] - q[0]) + sq(q) * (p[0] - r[0]) + sq(r) * (q[0] - p[0])) / d;
		const radius = Math.hypot(p[0] - ux, p[1] - uy);
		// Orthogonal circles satisfy |centre|² = radius² + 1.
		expect(ux ** 2 + uy ** 2 - radius ** 2).toBeCloseTo(1, 6);
	});
});
