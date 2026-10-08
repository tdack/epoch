/**
 * The Orrery's decoration: children drift round their parents' barycentre. Purely visual, so it
 * lives apart from the layout and nothing about who is related to whom depends on it. Picking and
 * names follow the drifted positions; the scene turns it off under reduced motion.
 *
 * Each household (people joined by drawn unions) moves as one rigid group, so a binary's tether
 * never stretches. The group is driven by one member that has drawn parents, and it rotates about
 * those parents' displayed barycentre; the parents may themselves be drifting, which nests the
 * orbits. When two partners both have drawn parents only one of them drives, so the other's line
 * up to its own parents stretches a little.
 */

import { unitFromId, type OrreryLayout } from './orrery.js';
import type { Vec3 } from './orrery-simulation.js';

/** Angular speed range in radians per second: a full turn takes between about one and two minutes. */
const MIN_ORBIT_RAD_PER_SECOND = 0.05;
const MAX_ORBIT_RAD_PER_SECOND = 0.1;

interface OrbitGroup {
	memberIds: string[];
	/** Null when nobody in the household has drawn parents: the group stays put. */
	driver: {
		id: string;
		/** Whose displayed positions make the barycentre the driver orbits. */
		anchorIds: string[];
		omega: number;
		axis: Vec3;
	} | null;
}

export interface OrbitPlan {
	/** Parents' groups come before their children's, so one pass in order is enough. */
	groups: OrbitGroup[];
}

function axisFor(id: string): Vec3 {
	// Mostly vertical with a tilt, so orbits look different from one another but never edge-on.
	const x = (unitFromId(id, 7) - 0.5) * 0.6;
	const z = (unitFromId(id, 8) - 0.5) * 0.6;
	const length = Math.hypot(x, 1, z);
	return { x: x / length, y: 1 / length, z: z / length };
}

export function buildOrbitPlan(layout: OrreryLayout): OrbitPlan {
	// Households by union-find over the drawn unions.
	const parent = new Map(layout.people.map((p) => [p.id, p.id]));
	const find = (id: string): string => {
		let root = id;
		while (parent.get(root) !== root) root = parent.get(root)!;
		parent.set(id, root);
		return root;
	};
	for (const u of layout.unions)
		for (const id of u.partnerIds.slice(1)) parent.set(find(id), find(u.partnerIds[0]));

	const membersOf = new Map<string, string[]>();
	for (const p of layout.people) {
		const root = find(p.id);
		membersOf.set(root, [...(membersOf.get(root) ?? []), p.id]);
	}
	const unionById = new Map(layout.unions.map((u) => [u.id, u]));
	const anchorsOf = new Map<string, string[]>();
	for (const link of layout.childLinks) {
		if (anchorsOf.has(link.childId)) continue;
		anchorsOf.set(
			link.childId,
			link.fromUnionId !== null ? unionById.get(link.fromUnionId)!.partnerIds : link.parentIds
		);
	}

	const groups = new Map<string, OrbitGroup>();
	for (const [root, memberIds] of membersOf) {
		const driverId = memberIds.find((id) => anchorsOf.has(id));
		groups.set(root, {
			memberIds,
			driver:
				driverId === undefined
					? null
					: {
							id: driverId,
							anchorIds: anchorsOf.get(driverId)!,
							omega:
								(unitFromId(driverId, 9) < 0.5 ? -1 : 1) *
								(MIN_ORBIT_RAD_PER_SECOND +
									unitFromId(driverId, 10) * (MAX_ORBIT_RAD_PER_SECOND - MIN_ORBIT_RAD_PER_SECOND)),
							axis: axisFor(driverId)
						}
		});
	}

	// Depth-first so a group's anchors are placed before it; a loop in bad data drops that
	// group's driver rather than recursing forever.
	const ordered: OrbitGroup[] = [];
	const state = new Map<string, 'visiting' | 'done'>();
	const visit = (root: string) => {
		if (state.get(root) === 'done') return;
		const group = groups.get(root)!;
		if (state.get(root) === 'visiting') {
			group.driver = null;
			return;
		}
		state.set(root, 'visiting');
		for (const id of group.driver?.anchorIds ?? []) visit(find(id));
		// A cycle may have cleared this group's driver above; either way it is placed now.
		state.set(root, 'done');
		ordered.push(group);
	};
	for (const root of groups.keys()) visit(root);
	return { groups: ordered };
}

/**
 * Writes the drifted position of every person at `timeSeconds` into `out` (replacing entries). At
 * time zero it is exactly the layout. `out` is reused so the animation allocates nothing per frame.
 */
export function orbitPositions(
	layout: OrreryLayout,
	plan: OrbitPlan,
	timeSeconds: number,
	out: Map<string, Vec3>
): void {
	const rest = new Map(layout.people.map((p) => [p.id, p]));
	const at = (id: string): Vec3 => out.get(id) ?? rest.get(id)!;
	for (const group of plan.groups) {
		const driver = group.driver;
		if (!driver) {
			for (const id of group.memberIds) set(out, id, rest.get(id)!);
			continue;
		}
		// Barycentre of the anchors, at rest and as displayed.
		const restB = { x: 0, y: 0, z: 0 };
		const nowB = { x: 0, y: 0, z: 0 };
		for (const id of driver.anchorIds) {
			const r = rest.get(id)!;
			const n = at(id);
			restB.x += r.x;
			restB.y += r.y;
			restB.z += r.z;
			nowB.x += n.x;
			nowB.y += n.y;
			nowB.z += n.z;
		}
		const k = driver.anchorIds.length;
		const d = rest.get(driver.id)!;
		const ox = d.x - restB.x / k;
		const oy = d.y - restB.y / k;
		const oz = d.z - restB.z / k;
		// Rodrigues' rotation of the offset about the axis, by the angle this much time has turned.
		const angle = driver.omega * timeSeconds;
		const c = Math.cos(angle);
		const s = Math.sin(angle);
		const { x: ax, y: ay, z: az } = driver.axis;
		const dot = ax * ox + ay * oy + az * oz;
		const rx = ox * c + (ay * oz - az * oy) * s + ax * dot * (1 - c);
		const ry = oy * c + (az * ox - ax * oz) * s + ay * dot * (1 - c);
		const rz = oz * c + (ax * oy - ay * ox) * s + az * dot * (1 - c);
		const dx = nowB.x / k + rx - d.x;
		const dy = nowB.y / k + ry - d.y;
		const dz = nowB.z / k + rz - d.z;
		// The whole household moves by the driver's displacement, so its binaries stay rigid.
		for (const id of group.memberIds) {
			const r = rest.get(id)!;
			set(out, id, { x: r.x + dx, y: r.y + dy, z: r.z + dz });
		}
	}
}

function set(out: Map<string, Vec3>, id: string, to: Vec3): void {
	const existing = out.get(id);
	if (existing) {
		existing.x = to.x;
		existing.y = to.y;
		existing.z = to.z;
	} else out.set(id, { x: to.x, y: to.y, z: to.z });
}
