/**
 * The faint stars behind the dark 3D stages. They sit on a far shell that follows the camera, so
 * orbiting slides the stars against the people and gives the stage some depth, while they never
 * get close enough to read as part of the tree. Pure data here, so the layout is testable without
 * a WebGL context; `three-stage.ts` turns it into a `Points` object.
 */

/** A small seeded generator: the same sky every time, so a rebuilt stage does not twinkle to a new one. */
function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export interface StarField {
	/** x, y, z per star, on a sphere of the given radius. */
	positions: Float32Array;
	/** r, g, b per star, each a dim, slightly tinted white so some stars read as brighter than others. */
	colours: Float32Array;
}

/**
 * Stars spread evenly over a sphere (a uniform height and angle, not uniform angles, which would
 * crowd the poles). Brightness is skewed low: a few bright stars among many faint ones reads as
 * depth, where a uniform brightness reads as noise.
 */
export function starField(count: number, radius: number, seed = 0x5eed): StarField {
	const random = mulberry32(seed);
	const positions = new Float32Array(count * 3);
	const colours = new Float32Array(count * 3);
	for (let i = 0; i < count; i++) {
		const height = random() * 2 - 1;
		const angle = random() * Math.PI * 2;
		const ring = Math.sqrt(1 - height * height);
		positions[i * 3] = Math.cos(angle) * ring * radius;
		positions[i * 3 + 1] = height * radius;
		positions[i * 3 + 2] = Math.sin(angle) * ring * radius;
		const brightness = 0.25 + 0.75 * random() ** 3;
		// Cool to warm by a few percent, as real stars are; red and blue stay close so nothing reads as a colour.
		const warmth = random() - 0.5;
		colours[i * 3] = Math.min(1, brightness * (0.92 + 0.16 * warmth));
		colours[i * 3 + 1] = brightness * 0.95;
		colours[i * 3 + 2] = Math.min(1, brightness * (1.05 - 0.16 * warmth));
	}
	return { positions, colours };
}
