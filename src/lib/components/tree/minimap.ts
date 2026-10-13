/**
 * Pure geometry for the Flat canvas's minimap: the whole tree scaled into a small box, and the part
 * of it the canvas shows. Kept apart from the component so it tests without a DOM.
 */

import type { ViewTransform } from './view-geometry.js';

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** How layout space maps into the minimap: `(x - originX) * scale` is a minimap pixel. */
export interface MinimapFrame {
	scale: number;
	originX: number;
	originY: number;
	/** The box in pixels; it takes the tree's shape, within the maximum it was given. */
	width: number;
	height: number;
}

/** Below this a box is too thin to hit with a pointer, for a tree of one row or one person. */
const MIN_SIDE_PX = 48;

/** Scale the tree's bounds to fit in `maxWidth` × `maxHeight` pixels, centred if a side is padded out. */
export function fitMinimap(
	bounds: { minX: number; minY: number; maxX: number; maxY: number },
	maxWidth: number,
	maxHeight: number
): MinimapFrame {
	const treeWidth = Math.max(1, bounds.maxX - bounds.minX);
	const treeHeight = Math.max(1, bounds.maxY - bounds.minY);
	const scale = Math.min(maxWidth / treeWidth, maxHeight / treeHeight);
	const width = Math.min(maxWidth, Math.max(MIN_SIDE_PX, treeWidth * scale));
	const height = Math.min(maxHeight, Math.max(MIN_SIDE_PX, treeHeight * scale));
	return {
		scale,
		originX: bounds.minX - (width / scale - treeWidth) / 2,
		originY: bounds.minY - (height / scale - treeHeight) / 2,
		width,
		height
	};
}

/** The part of layout space the canvas shows, from its transform and pixel size. */
export function visibleRect(
	transform: ViewTransform,
	size: { width: number; height: number }
): Rect {
	return {
		x: -transform.x / transform.k,
		y: -transform.y / transform.k,
		width: size.width / transform.k,
		height: size.height / transform.k
	};
}

/** A layout-space rectangle in minimap pixels. */
export function toMinimap(frame: MinimapFrame, rect: Rect): Rect {
	return {
		x: (rect.x - frame.originX) * frame.scale,
		y: (rect.y - frame.originY) * frame.scale,
		width: rect.width * frame.scale,
		height: rect.height * frame.scale
	};
}

/** A minimap pixel back in layout space. */
export function fromMinimap(frame: MinimapFrame, x: number, y: number): { x: number; y: number } {
	return { x: frame.originX + x / frame.scale, y: frame.originY + y / frame.scale };
}

/**
 * Whether the canvas shows the whole tree, so the minimap has nothing to add. A small tolerance
 * keeps a fitted view, whose edges land on the bounds to within rounding, from counting as cut off.
 */
export function isWholeVisible(
	bounds: { minX: number; minY: number; maxX: number; maxY: number },
	view: Rect
): boolean {
	const slack = 1;
	return (
		view.x <= bounds.minX + slack &&
		view.y <= bounds.minY + slack &&
		view.x + view.width >= bounds.maxX - slack &&
		view.y + view.height >= bounds.maxY - slack
	);
}
