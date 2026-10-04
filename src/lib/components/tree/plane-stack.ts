/**
 * The geometry behind the 3D views: camera presets, where a floor's rows sit, and the CSS that
 * turns a line between two points in the stage into a thin element rotated into place. Pure, so
 * the maths is tested without a browser (ADR-029).
 *
 * Stage coordinates are the plane's own: x across, y down the plane, z toward the viewer before
 * the camera tilts the stage.
 */

import {
	EMPTY_LAYOUT,
	LAYOUT_METRICS,
	type Band,
	type LayoutMetrics,
	type TreeLayout
} from '#lib/tree-layout/index.js';
import type { FloorsLayout } from '#lib/tree-layout/floors.js';

/** Tilt of the whole stage about X for `floors`; 0 would face the planes straight on. */
const FLOOR_TILT_DEG = 50;
/** Distance between two neighbouring floors along Z. */
export const FLOOR_GAP_PX = 260;
/** Vertical space one band row takes on a floor; holds a card and a union hanging below it. */
export const BAND_ROW_PX = 170;
/** How far the camera sits from the stage; a larger value flattens perspective. */
export const PERSPECTIVE_PX = 2400;
/** Opacity of a band's row, so the sibling and cousin lines recede behind the direct line. */
export const BAND_OPACITY: Record<Band, number> = { 0: 1, 1: 0.9, 2: 0.78 };
/** Thickness of a depth connector. */
export const CONNECTOR_WIDTH_PX = 2;

const CAMERA_PRESETS = {
	floors: { rotateXDeg: FLOOR_TILT_DEG, rotateYDeg: 0 }
} as const;
export type CameraPresetName = keyof typeof CAMERA_PRESETS;

export function cameraTransform(name: CameraPresetName): string {
	const { rotateXDeg, rotateYDeg } = CAMERA_PRESETS[name];
	return `rotateX(${rotateXDeg}deg) rotateY(${rotateYDeg}deg)`;
}

/** Band 0 sits at the front of a floor; each further band recedes one row. */
export function bandRowY(band: Band): number {
	return (2 - band) * BAND_ROW_PX;
}

/** Older generations sit higher: a negative generation is an ancestor. */
export function floorZ(generation: number): number {
	return -generation * FLOOR_GAP_PX || 0;
}

export interface StagePoint {
	x: number;
	y: number;
	z: number;
}

/**
 * Where a stage point lands on screen with the camera tilted by `rotateXDeg`. Perspective is left
 * out: this frames the view and keeps a card in sight, and a few percent of error there only
 * shifts the margin.
 */
export function projectToScreen(point: StagePoint, rotateXDeg = FLOOR_TILT_DEG) {
	const radians = (rotateXDeg * Math.PI) / 180;
	return {
		x: point.x,
		y: point.y * Math.cos(radians) - point.z * Math.sin(radians)
	};
}

/**
 * The transform that draws a 2px-wide element of height `length` from `from` to `to`. The element
 * is laid out with its top-left at the origin and `transform-origin: 0 0`, so it starts at `from`.
 */
export function connectorStyle(from: StagePoint, to: StagePoint) {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const dz = to.z - from.z;
	const length = Math.hypot(dx, dy, dz);
	// An element's height runs down its own y axis. Aim that axis at `to`: yaw about Z to the
	// direction in the xy plane, then pitch about the new x axis out of the plane.
	const yaw = Math.atan2(dy, dx) - Math.PI / 2;
	const horizontal = Math.hypot(dx, dy);
	const pitch = Math.atan2(dz, horizontal);
	return {
		length,
		transform: `translate3d(${from.x}px, ${from.y}px, ${from.z}px) rotateZ(${yaw}rad) rotateX(${pitch}rad)`
	};
}

export function floorPoint(generation: number, band: Band, x: number, dy = 0): StagePoint {
	return { x, y: bandRowY(band) + dy, z: floorZ(generation) };
}

/**
 * The floors as a flat layout of where things land on screen, so the pan and zoom (which frame
 * `bounds`, keep the focus person put on a refocus and watch `collapsers`) work unchanged. Only
 * positions and bounds are filled in.
 */
export function framingLayout(layout: FloorsLayout, m: LayoutMetrics = LAYOUT_METRICS): TreeLayout {
	const project = (generation: number, band: Band, x: number) =>
		projectToScreen(floorPoint(generation, band, x));
	const people = layout.people.map((p) => ({ ...p, ...project(p.generation, p.band, p.x) }));
	if (people.length === 0) return EMPTY_LAYOUT;
	const boxes = [
		...people.map((p) => ({ x: p.x, y: p.y, halfW: m.cardWidth / 2, halfH: m.cardHeight / 2 })),
		...layout.stubs.map((s) => ({
			...project(s.generation, s.band, s.x),
			halfW: m.stubWidth / 2,
			halfH: m.stubHeight / 2
		}))
	];
	return {
		...EMPTY_LAYOUT,
		focusPersonId: layout.focusPersonId,
		people,
		collapsers: layout.collapsers.map((c) => ({ ...c, ...project(c.generation, c.band, c.x) })),
		bounds: {
			minX: Math.min(...boxes.map((b) => b.x - b.halfW)),
			maxX: Math.max(...boxes.map((b) => b.x + b.halfW)),
			minY: Math.min(...boxes.map((b) => b.y - b.halfH)),
			maxY: Math.max(...boxes.map((b) => b.y + b.halfH))
		}
	};
}
