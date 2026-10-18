/** The drawer's fixed width before it could be resized (`sm:w-96`); it never goes narrower. */
export const DRAWER_MIN_WIDTH_PX = 384;

/** Canvas left showing beside the widest drawer, so the tree is never covered entirely. */
const CANVAS_MARGIN_PX = 320;

/**
 * Narrowest window that offers the handle (Tailwind's `md`). Below it the drawer keeps its fixed
 * width, since the few pixels of range left are not worth a control that is hard to hit.
 */
const DRAWER_RESIZE_MIN_VIEWPORT_PX = 768;

export const DRAWER_WIDTH_STORAGE_KEY = 'epoch.drawer-width';

/** The widest the drawer may be in a window this wide; never less than the minimum. */
export function maxDrawerWidth(viewportWidthPx: number): number {
	return Math.max(DRAWER_MIN_WIDTH_PX, viewportWidthPx - CANVAS_MARGIN_PX);
}

/** Holds a wanted width inside what this window allows; anything unreadable becomes the minimum. */
export function clampDrawerWidth(widthPx: number, viewportWidthPx: number): number {
	if (!Number.isFinite(widthPx)) return DRAWER_MIN_WIDTH_PX;
	return Math.round(
		Math.min(maxDrawerWidth(viewportWidthPx), Math.max(DRAWER_MIN_WIDTH_PX, widthPx))
	);
}

/** Whether a window this wide offers the handle at all. */
export function canResizeDrawer(viewportWidthPx: number): boolean {
	return (
		viewportWidthPx >= DRAWER_RESIZE_MIN_VIEWPORT_PX &&
		maxDrawerWidth(viewportWidthPx) > DRAWER_MIN_WIDTH_PX
	);
}
