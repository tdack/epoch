/**
 * Hyperbolic geodesics of the Poincaré ball: the straight lines of the Ball view. Between two
 * points the geodesic is the arc of the circle that meets the unit sphere at right angles, or a
 * straight line when the two points and the centre are collinear. Pure maths on `[x, y, z]`.
 */

export type Vec3 = [number, number, number];

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lengthOf = (a: Vec3) => Math.sqrt(dot(a, a));
const EPSILON = 1e-9;

/** `segments + 1` points along the geodesic from `a` to `b`, endpoints included. */
export function geodesicPoints(a: Vec3, b: Vec3, segments: number): Vec3[] {
	const straight = (): Vec3[] =>
		Array.from({ length: segments + 1 }, (_, i) => {
			const t = i / segments;
			return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
		});
	const lengthA = lengthOf(a);
	if (lengthA < EPSILON) return straight();

	// Work in the plane through the centre, a and b: e1 along a, e2 towards b.
	const e1: Vec3 = [a[0] / lengthA, a[1] / lengthA, a[2] / lengthA];
	const along = dot(b, e1);
	const rest: Vec3 = [b[0] - along * e1[0], b[1] - along * e1[1], b[2] - along * e1[2]];
	const side = lengthOf(rest);
	if (side < EPSILON) return straight();
	const e2: Vec3 = [rest[0] / side, rest[1] / side, rest[2] / side];

	// The circle's centre c satisfies c·a = (1 + |a|²)/2 and c·b = (1 + |b|²)/2: it is orthogonal
	// to the unit sphere, so |c|² = radius² + 1.
	const cx = (1 + lengthA * lengthA) / (2 * lengthA);
	const cy = ((1 + dot(b, b)) / 2 - cx * along) / side;
	const radius = Math.sqrt(Math.max(cx * cx + cy * cy - 1, 0));
	const start = Math.atan2(0 - cy, lengthA - cx);
	const end = Math.atan2(side - cy, along - cx);
	let sweep = end - start;
	// The short way round, which is the one inside the ball.
	if (sweep > Math.PI) sweep -= 2 * Math.PI;
	if (sweep < -Math.PI) sweep += 2 * Math.PI;

	return Array.from({ length: segments + 1 }, (_, i) => {
		if (i === 0) return a;
		if (i === segments) return b;
		const angle = start + (sweep * i) / segments;
		const u = cx + radius * Math.cos(angle);
		const v = cy + radius * Math.sin(angle);
		return [u * e1[0] + v * e2[0], u * e1[1] + v * e2[1], u * e1[2] + v * e2[2]];
	});
}
