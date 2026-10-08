/**
 * The force simulation behind the Orrery view. Pure and deterministic: bodies, springs and a fixed
 * iteration budget in, positions out. It knows nothing of people or unions, so `orrery.ts` can feed
 * it the graph and the tests can feed it small hand-made systems.
 *
 * Not a live physics loop: the layout call runs it to rest once, and the canvas animates only an
 * orbital decoration on top of the result (see `orrery-orbit.ts`).
 */

export interface Vec3 {
	x: number;
	y: number;
	z: number;
}

export interface SimBody extends Vec3 {
	/** Where the weak vertical pull settles this body, so generations stratify loosely. */
	restY: number;
}

export interface SimSpring {
	a: number;
	b: number;
	restUnits: number;
	/** Spring constant: force per unit of stretch, on each end. */
	strength: number;
}

/** A child pulled toward the midpoint of its parents, with the reaction shared among them. */
export interface SimBarycentreLink {
	child: number;
	parents: number[];
	restUnits: number;
	strength: number;
}

export interface SimOptions {
	iterations: number;
	/** Body pairs that do not repel each other: the bound partners of a union. */
	boundPairs: Array<[number, number]>;
	/** The body gravity pulls toward. */
	gravityTo: number;
	/** Past this many bodies repulsion uses a Barnes–Hut octree. */
	barnesHutThreshold: number;
}

/** Repulsion constant: at the binary distance it is a gentle nudge, in a crowd it keeps stars apart. */
const REPEL = 7;
/** Softening so two bodies on top of each other do not fling apart. */
const SOFTENING = 0.6;
const GRAVITY = 0.012;
const VERTICAL_PULL = 0.035;
const VELOCITY_KEEP = 0.58;
/** The cooling schedule's floor: forces never quite vanish, so the last iterations still settle. */
const ALPHA_FLOOR = 0.04;
/** Stop early once no body moves further than this in an iteration, in scene units. */
const REST_TOLERANCE_UNITS = 0.002;
/** Barnes–Hut opening angle: a cell farther than its size over this is treated as one body. */
const THETA = 0.9;
const MAX_TREE_DEPTH = 24;
const MAX_STEP_UNITS = 3;

interface Cell {
	cx: number;
	cy: number;
	cz: number;
	half: number;
	count: number;
	sx: number;
	sy: number;
	sz: number;
	/** Set while the cell holds exactly one body and has not split. */
	body: number;
	kids: Array<Cell | null> | null;
}

function newCell(cx: number, cy: number, cz: number, half: number): Cell {
	return { cx, cy, cz, half, count: 0, sx: 0, sy: 0, sz: 0, body: -1, kids: null };
}

function octant(cell: Cell, x: number, y: number, z: number): number {
	return (x > cell.cx ? 1 : 0) | (y > cell.cy ? 2 : 0) | (z > cell.cz ? 4 : 0);
}

function insert(cell: Cell, bodies: Vec3[], index: number, depth: number): void {
	const p = bodies[index];
	if (cell.count === 0) {
		cell.body = index;
	} else if (depth < MAX_TREE_DEPTH) {
		if (cell.kids === null) {
			cell.kids = new Array<Cell | null>(8).fill(null);
			const held = cell.body;
			cell.body = -1;
			insertChild(cell, bodies, held, depth);
		}
		insertChild(cell, bodies, index, depth);
	}
	cell.count++;
	cell.sx += p.x;
	cell.sy += p.y;
	cell.sz += p.z;
}

function insertChild(cell: Cell, bodies: Vec3[], index: number, depth: number): void {
	const p = bodies[index];
	const o = octant(cell, p.x, p.y, p.z);
	let kid = cell.kids![o];
	if (kid === null) {
		const h = cell.half / 2;
		kid = newCell(
			cell.cx + (o & 1 ? h : -h),
			cell.cy + (o & 2 ? h : -h),
			cell.cz + (o & 4 ? h : -h),
			h
		);
		cell.kids![o] = kid;
	}
	insert(kid, bodies, index, depth + 1);
}

function buildTree(bodies: Vec3[]): Cell {
	let min = Infinity;
	let max = -Infinity;
	for (const b of bodies) {
		min = Math.min(min, b.x, b.y, b.z);
		max = Math.max(max, b.x, b.y, b.z);
	}
	const half = Math.max((max - min) / 2, 1) * 1.001;
	const mid = (min + max) / 2;
	const root = newCell(mid, mid, mid, half);
	for (let i = 0; i < bodies.length; i++) insert(root, bodies, i, 0);
	return root;
}

/** Adds the repulsion on `index` from everything in `cell` (or its single stand-in) into `out`. */
function repelFromTree(cell: Cell, bodies: Vec3[], index: number, out: Vec3): void {
	if (cell.count === 0) return;
	const p = bodies[index];
	const mx = cell.sx / cell.count;
	const my = cell.sy / cell.count;
	const mz = cell.sz / cell.count;
	const dx = p.x - mx;
	const dy = p.y - my;
	const dz = p.z - mz;
	const d2 = dx * dx + dy * dy + dz * dz;
	const isLeaf = cell.kids === null;
	if (isLeaf || (cell.half * 2) ** 2 < THETA * THETA * d2) {
		if (isLeaf && cell.body === index) return;
		// A leaf at the depth cap can hold several coincident bodies; `count` weights them.
		const f = (REPEL * cell.count) / ((d2 + SOFTENING) * Math.sqrt(d2 + SOFTENING));
		out.x += dx * f;
		out.y += dy * f;
		out.z += dz * f;
		return;
	}
	for (const kid of cell.kids!) if (kid) repelFromTree(kid, bodies, index, out);
}

export interface SimResult {
	/** Iterations actually run: the budget, or fewer when the system came to rest. */
	iterations: number;
}

/** Moves `bodies` in place. The same inputs always give the same positions. */
export function runSimulation(
	bodies: SimBody[],
	springs: SimSpring[],
	links: SimBarycentreLink[],
	options: SimOptions
): SimResult {
	const n = bodies.length;
	const vx = new Float64Array(n);
	const vy = new Float64Array(n);
	const vz = new Float64Array(n);
	const fx = new Float64Array(n);
	const fy = new Float64Array(n);
	const fz = new Float64Array(n);
	const scratch: Vec3 = { x: 0, y: 0, z: 0 };
	const gravityTo = bodies[options.gravityTo];
	const px = new Float64Array(n);
	const py = new Float64Array(n);
	const pz = new Float64Array(n);
	let ran = 0;

	for (let iter = 0; iter < options.iterations; iter++) {
		ran++;
		const alpha = Math.max(ALPHA_FLOOR, 1 - iter / options.iterations);
		fx.fill(0);
		fy.fill(0);
		fz.fill(0);

		if (n > options.barnesHutThreshold) {
			const root = buildTree(bodies);
			for (let i = 0; i < n; i++) {
				scratch.x = scratch.y = scratch.z = 0;
				repelFromTree(root, bodies, i, scratch);
				fx[i] += scratch.x;
				fy[i] += scratch.y;
				fz[i] += scratch.z;
			}
		} else {
			// Typed copies of the positions keep this O(n²) loop out of object property lookups.
			for (let i = 0; i < n; i++) {
				px[i] = bodies[i].x;
				py[i] = bodies[i].y;
				pz[i] = bodies[i].z;
			}
			for (let i = 0; i < n; i++) {
				const xi = px[i];
				const yi = py[i];
				const zi = pz[i];
				let ax = 0;
				let ay = 0;
				let az = 0;
				for (let j = i + 1; j < n; j++) {
					const dx = xi - px[j];
					const dy = yi - py[j];
					const dz = zi - pz[j];
					const d2 = dx * dx + dy * dy + dz * dz + SOFTENING;
					const f = REPEL / (d2 * Math.sqrt(d2));
					ax += dx * f;
					ay += dy * f;
					az += dz * f;
					fx[j] -= dx * f;
					fy[j] -= dy * f;
					fz[j] -= dz * f;
				}
				fx[i] += ax;
				fy[i] += ay;
				fz[i] += az;
			}
		}
		// Partners are held by their spring alone, so take back the push both loops gave them.
		for (const [a, b] of options.boundPairs) {
			const dx = bodies[a].x - bodies[b].x;
			const dy = bodies[a].y - bodies[b].y;
			const dz = bodies[a].z - bodies[b].z;
			const d2 = dx * dx + dy * dy + dz * dz + SOFTENING;
			const f = REPEL / (d2 * Math.sqrt(d2));
			fx[a] -= dx * f;
			fy[a] -= dy * f;
			fz[a] -= dz * f;
			fx[b] += dx * f;
			fy[b] += dy * f;
			fz[b] += dz * f;
		}

		for (const s of springs) {
			const a = bodies[s.a];
			const b = bodies[s.b];
			const dx = b.x - a.x;
			const dy = b.y - a.y;
			const dz = b.z - a.z;
			const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
			const f = (s.strength * (d - s.restUnits)) / d;
			fx[s.a] += dx * f;
			fy[s.a] += dy * f;
			fz[s.a] += dz * f;
			fx[s.b] -= dx * f;
			fy[s.b] -= dy * f;
			fz[s.b] -= dz * f;
		}

		for (const link of links) {
			let bx = 0;
			let by = 0;
			let bz = 0;
			for (const p of link.parents) {
				bx += bodies[p].x;
				by += bodies[p].y;
				bz += bodies[p].z;
			}
			const k = link.parents.length;
			bx /= k;
			by /= k;
			bz /= k;
			const c = bodies[link.child];
			const dx = bx - c.x;
			const dy = by - c.y;
			const dz = bz - c.z;
			const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
			const f = (link.strength * (d - link.restUnits)) / d;
			fx[link.child] += dx * f;
			fy[link.child] += dy * f;
			fz[link.child] += dz * f;
			for (const p of link.parents) {
				fx[p] -= (dx * f) / k;
				fy[p] -= (dy * f) / k;
				fz[p] -= (dz * f) / k;
			}
		}

		let maxStep = 0;
		for (let i = 0; i < n; i++) {
			const b = bodies[i];
			fx[i] -= (b.x - gravityTo.x) * GRAVITY;
			fy[i] -= (b.y - gravityTo.y) * GRAVITY;
			fz[i] -= (b.z - gravityTo.z) * GRAVITY;
			fy[i] += (b.restY - b.y) * VERTICAL_PULL;
			// Binary and barycentre springs are stiff on purpose, so only the soft forces cool.
			vx[i] = vx[i] * VELOCITY_KEEP + fx[i] * alpha;
			vy[i] = vy[i] * VELOCITY_KEEP + fy[i] * alpha;
			vz[i] = vz[i] * VELOCITY_KEEP + fz[i] * alpha;
			const speed = Math.hypot(vx[i], vy[i], vz[i]);
			const scale = speed > MAX_STEP_UNITS ? MAX_STEP_UNITS / speed : 1;
			b.x += vx[i] * scale;
			b.y += vy[i] * scale;
			b.z += vz[i] * scale;
			maxStep = Math.max(maxStep, speed * scale);
		}
		if (maxStep < REST_TOLERANCE_UNITS && iter > 20) break;
	}
	return { iterations: ran };
}
