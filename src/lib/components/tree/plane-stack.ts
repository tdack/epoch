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
import type { LayersLayout } from '#lib/tree-layout/layers.js';

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

/**
 * How the camera sees the stack of planes in `layers`. Front looks nearly straight on, Angled turns
 * the stack so each plane shows its edge, and Exploded does the same with the planes pulled apart.
 */
export const LAYER_VIEWS = { FRONT: 'front', ANGLED: 'angled', EXPLODED: 'exploded' } as const;
export type LayerView = (typeof LAYER_VIEWS)[keyof typeof LAYER_VIEWS];
/** Distance between two neighbouring planes along Z, per view. */
const LAYER_GAP_PX: Record<LayerView, number> = { front: 120, angled: 200, exploded: 380 };
/**
 * How far each plane further back is shifted across and up. A plane is a flat chart in the same
 * coordinates as the hourglass, so without it two planes would put cards at the same spot; with it
 * no two cards of different planes overlap on screen (cards are 210 by 74, a row is 170 tall).
 */
export const LAYER_STAGGER_PX = { x: 130, y: 85 } as const;

const CAMERA_PRESETS = {
	floors: { rotateXDeg: FLOOR_TILT_DEG, rotateYDeg: 0 },
	'layers-front': { rotateXDeg: 4, rotateYDeg: -6 },
	'layers-angled': { rotateXDeg: 10, rotateYDeg: -26 },
	'layers-exploded': { rotateXDeg: 14, rotateYDeg: -34 }
} as const;
export type CameraPresetName = keyof typeof CAMERA_PRESETS;

export function layerCamera(view: LayerView): CameraPresetName {
	return `layers-${view}`;
}

export function cameraTransform(name: CameraPresetName): string {
	const { rotateXDeg, rotateYDeg } = CAMERA_PRESETS[name];
	return `rotateX(${rotateXDeg}deg) rotateY(${rotateYDeg}deg)`;
}

/** Where a plane stands in the stage: further back for a higher plane, and staggered across and up. */
export function layerOffset(plane: Band, view: LayerView) {
	return {
		x: plane * LAYER_STAGGER_PX.x,
		y: -plane * LAYER_STAGGER_PX.y || 0,
		z: -plane * LAYER_GAP_PX[view] || 0
	};
}

/** A point on a row of a plane, in stage coordinates. `dy` is the distance below the row's centre. */
export function layerPoint(
	plane: Band,
	generation: number,
	x: number,
	view: LayerView,
	m: LayoutMetrics = LAYOUT_METRICS,
	dy = 0
): StagePoint {
	const offset = layerOffset(plane, view);
	return { x: x + offset.x, y: generation * m.rowHeight + dy + offset.y, z: offset.z };
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
 * Where a stage point lands on screen with the camera turned by `rotateYDeg` and then tilted by
 * `rotateXDeg` (CSS applies the right-hand transform first). Perspective is left out: this frames
 * the view and keeps a card in sight, and a few percent of error there only shifts the margin.
 */
export function projectToScreen(point: StagePoint, rotateXDeg = FLOOR_TILT_DEG, rotateYDeg = 0) {
	const tilt = (rotateXDeg * Math.PI) / 180;
	const turn = (rotateYDeg * Math.PI) / 180;
	const turnedX = point.x * Math.cos(turn) + point.z * Math.sin(turn);
	const turnedZ = -point.x * Math.sin(turn) + point.z * Math.cos(turn);
	return {
		x: turnedX,
		y: point.y * Math.cos(tilt) - turnedZ * Math.sin(tilt)
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

/**
 * The planes as a flat layout of where things land on screen, for the same pan and zoom as
 * `framingLayout`. Planes the viewer has hidden are left out so the fit follows what is drawn.
 */
export function layersFraming(
	layout: LayersLayout,
	view: LayerView,
	hiddenPlanes: ReadonlySet<Band> = new Set(),
	m: LayoutMetrics = LAYOUT_METRICS
): TreeLayout {
	const { rotateXDeg, rotateYDeg } = CAMERA_PRESETS[layerCamera(view)];
	const project = (plane: Band, generation: number, x: number) =>
		projectToScreen(layerPoint(plane, generation, x, view, m), rotateXDeg, rotateYDeg);
	const people = layout.people
		.filter((p) => !hiddenPlanes.has(p.plane))
		.map((p) => ({ ...p, ...project(p.plane, p.generation, p.x) }));
	if (people.length === 0) return EMPTY_LAYOUT;
	const boxes = [
		...people.map((p) => ({ x: p.x, y: p.y, halfW: m.cardWidth / 2, halfH: m.cardHeight / 2 })),
		...layout.ghosts
			.filter((g) => !hiddenPlanes.has(g.plane))
			.map((g) => ({
				...project(g.plane, g.generation, g.x),
				halfW: m.cardWidth / 2,
				halfH: m.cardHeight / 2
			})),
		...layout.stubs
			.filter((s) => !hiddenPlanes.has(s.plane))
			.map((s) => ({
				...project(s.plane, s.generation, s.x),
				halfW: m.stubWidth / 2,
				halfH: m.stubHeight / 2
			}))
	];
	return {
		...EMPTY_LAYOUT,
		focusPersonId: layout.focusPersonId,
		people,
		collapsers: layout.collapsers
			.filter((c) => !hiddenPlanes.has(c.plane))
			.map((c) => ({ ...c, ...project(c.plane, c.y / m.rowHeight, c.x) })),
		bounds: {
			minX: Math.min(...boxes.map((b) => b.x - b.halfW)),
			maxX: Math.max(...boxes.map((b) => b.x + b.halfW)),
			minY: Math.min(...boxes.map((b) => b.y - b.halfH)),
			maxY: Math.max(...boxes.map((b) => b.y + b.halfH))
		}
	};
}
