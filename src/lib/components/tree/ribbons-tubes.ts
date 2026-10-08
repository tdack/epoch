/**
 * Geometry for the Ribbons view: one tapered tube per strand, built with `TubeGeometry` along a
 * `CatmullRomCurve3`, coloured per vertex so many strands merge into a single draw call. Kept
 * apart from the scene so the maths of a braid and a taper reads on its own.
 */

import {
	BufferAttribute,
	BufferGeometry,
	Color,
	CatmullRomCurve3,
	SphereGeometry,
	TubeGeometry,
	Vector3
} from 'three';

const CURVE_SAMPLES = 16;
const RADIAL_SEGMENTS = 6;
const BRAID_TURNS = 1.25;

export interface TubeSpec {
	from: Vector3;
	to: Vector3;
	radiusFrom: number;
	radiusTo: number;
	colourFrom: Color;
	colourTo: Color;
	alpha: number;
	/** Two or more partners twist about each other over the last stretch; null for a plain strand. */
	braid: { index: number; count: number; radius: number } | null;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
	const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
	return t * t * (3 - 2 * t);
}

/** Every strand and node carries four colour components so tubes, spheres and fades merge. */
function paint(geometry: BufferGeometry, colourAt: (vertex: number) => [Color, number]): void {
	const count = geometry.getAttribute('position').count;
	const colours = new Float32Array(count * 4);
	for (let i = 0; i < count; i++) {
		const [colour, alpha] = colourAt(i);
		colours.set([colour.r, colour.g, colour.b, alpha], i * 4);
	}
	geometry.setAttribute('color', new BufferAttribute(colours, 4));
}

/**
 * A strand runs down the flow with vertical ends, so strands meet knots and nodes head-on and
 * fan between them like a delta.
 */
export function strandGeometry(spec: TubeSpec): BufferGeometry {
	const { from, to } = spec;
	const handle = Math.max(Math.abs(from.y - to.y) * 0.45, 0.6);
	const c1 = from.clone().add(new Vector3(0, -handle, 0));
	const c2 = to.clone().add(new Vector3(0, handle, 0));
	const axis = to.clone().sub(from);
	const side = new Vector3().crossVectors(axis, new Vector3(0, 0, 1));
	if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
	side.normalize();
	const up = new Vector3().crossVectors(axis, side).normalize();

	const points: Vector3[] = [];
	for (let i = 0; i <= CURVE_SAMPLES; i++) {
		const t = i / CURVE_SAMPLES;
		const u = 1 - t;
		const p = new Vector3()
			.addScaledVector(from, u * u * u)
			.addScaledVector(c1, 3 * u * u * t)
			.addScaledVector(c2, 3 * u * t * t)
			.addScaledVector(to, t * t * t);
		if (spec.braid && spec.braid.count > 1) {
			const phase =
				(Math.PI * 2 * spec.braid.index) / spec.braid.count + BRAID_TURNS * Math.PI * 2 * t;
			const r = spec.braid.radius * smoothstep(0.3, 0.6, t) * (1 - smoothstep(0.88, 1, t));
			p.addScaledVector(side, Math.cos(phase) * r).addScaledVector(up, Math.sin(phase) * r);
		}
		points.push(p);
	}
	const curve = new CatmullRomCurve3(points, false, 'centripetal');
	const tubularSegments = CURVE_SAMPLES * 2;
	const tube = new TubeGeometry(curve, tubularSegments, 1, RADIAL_SEGMENTS, false);

	// TubeGeometry has a single radius, so each ring is rescaled about its centre to taper.
	const position = tube.getAttribute('position');
	const centre = new Vector3();
	const vertex = new Vector3();
	const ringSize = RADIAL_SEGMENTS + 1;
	for (let ring = 0; ring <= tubularSegments; ring++) {
		const t = ring / tubularSegments;
		curve.getPointAt(t, centre);
		const radius = spec.radiusFrom + (spec.radiusTo - spec.radiusFrom) * t;
		for (let k = 0; k < ringSize; k++) {
			const i = ring * ringSize + k;
			vertex.fromBufferAttribute(position, i).sub(centre).multiplyScalar(radius).add(centre);
			position.setXYZ(i, vertex.x, vertex.y, vertex.z);
		}
	}
	const mixed = new Color();
	paint(tube, (i) => {
		const t = Math.floor(i / ringSize) / tubularSegments;
		return [mixed.copy(spec.colourFrom).lerp(spec.colourTo, t), spec.alpha];
	});
	return tube;
}

/** A coloured sphere to merge with the tubes. */
export function nodeGeometry(
	at: Vector3,
	radius: number,
	colour: Color,
	alpha: number
): BufferGeometry {
	const sphere = new SphereGeometry(radius, 14, 10);
	sphere.translate(at.x, at.y, at.z);
	paint(sphere, () => [colour, alpha]);
	return sphere;
}
