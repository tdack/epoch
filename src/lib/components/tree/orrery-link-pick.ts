/**
 * An invisible pick target for one descent line of the Orrery. The lines are merged into a few
 * `LineSegments2` draws and drift every frame, so a per-line `Line2` would need its geometry
 * rewritten as often as the lines move. This object holds the two live end points instead and
 * answers the raycaster in screen space: a hit is a pointer within a few pixels of the segment as
 * it is drawn now, whatever the drift has done since the layout.
 *
 * It mirrors `Line2` raycasting in `three-stage.ts`: `params.Line2.threshold` is extra width in
 * pixels, of which half falls either side of the line.
 */

import { Object3D, Vector3, type Intersection, type Raycaster } from 'three';

const ndcA = new Vector3();
const ndcB = new Vector3();
const pointer = new Vector3();
const viewA = new Vector3();
const viewB = new Vector3();

export class LinkPickProxy extends Object3D {
	/** Both ends are read live: the scene moves them in place as the stars drift. */
	readonly start = new Vector3();
	readonly end = new Vector3();

	constructor(
		/** The drawn width of the line in pixels, which widens the band. */
		private readonly widthPx: number,
		private readonly size: () => { width: number; height: number }
	) {
		super();
	}

	override raycast(raycaster: Raycaster, intersects: Intersection[]): void {
		const camera = raycaster.camera;
		if (!camera) return;
		const { width, height } = this.size();
		if (width === 0 || height === 0) return;
		const threshold =
			(raycaster.params as { Line2?: { threshold?: number } }).Line2?.threshold ?? 0;
		const radiusPx = (this.widthPx + threshold) / 2;

		// Behind the camera a projection flips sides; a line that crosses the camera plane is
		// ignored, which only matters when the viewer is inside the cluster.
		viewA.copy(this.start).applyMatrix4(camera.matrixWorldInverse);
		viewB.copy(this.end).applyMatrix4(camera.matrixWorldInverse);
		if (viewA.z >= 0 || viewB.z >= 0) return;

		// The ray is the pointer's; one unit along it projects back to the pointer's position.
		pointer.copy(raycaster.ray.origin).add(raycaster.ray.direction).project(camera);
		ndcA.copy(this.start).project(camera);
		ndcB.copy(this.end).project(camera);

		const halfWidth = width / 2;
		const halfHeight = height / 2;
		const ax = ndcA.x * halfWidth;
		const ay = ndcA.y * halfHeight;
		const bx = ndcB.x * halfWidth;
		const by = ndcB.y * halfHeight;
		const px = pointer.x * halfWidth;
		const py = pointer.y * halfHeight;
		const dx = bx - ax;
		const dy = by - ay;
		const lengthSquared = dx * dx + dy * dy;
		const t =
			lengthSquared === 0
				? 0
				: Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
		if (Math.hypot(px - (ax + dx * t), py - (ay + dy * t)) > radiusPx) return;

		const point = new Vector3().lerpVectors(this.start, this.end, t);
		intersects.push({
			distance: point.distanceTo(raycaster.ray.origin),
			point,
			object: this
		});
	}
}
