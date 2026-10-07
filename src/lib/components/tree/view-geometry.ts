/**
 * Pure geometry for the Flat canvas's view: which people sit outside it, and whether the Fit button
 * has anything left to do. Kept apart from the viewport class so it tests without a DOM.
 */

export interface ViewTransform {
	x: number;
	y: number;
	k: number;
}

export const EDGE_DIRECTIONS = {
	LEFT: 'left',
	RIGHT: 'right',
	UP: 'up',
	DOWN: 'down'
} as const;
export type EdgeDirection = (typeof EDGE_DIRECTIONS)[keyof typeof EDGE_DIRECTIONS];

export interface OffscreenMarker {
	direction: EdgeDirection;
	/** People wholly outside the view in this direction. */
	count: number;
	/** Screen pixels to add to the transform's x and y to bring the nearest of them into view. */
	pan: { x: number; y: number };
}

const DIRECTION_ORDER: readonly EdgeDirection[] = [
	EDGE_DIRECTIONS.LEFT,
	EDGE_DIRECTIONS.RIGHT,
	EDGE_DIRECTIONS.UP,
	EDGE_DIRECTIONS.DOWN
];

/**
 * Group the people whose cards lie wholly outside the view by the edge they are nearest to, so each
 * person is counted once. A card that shows even a sliver is not counted: the sliver already says
 * there is someone there, and a marker over it would hide it.
 *
 * A person outside on both axes (a corner) goes to the axis they overshoot most, horizontal on a
 * tie. The pan centres the nearest person of a group on each axis where they are outside, so
 * repeating the tap walks along the row.
 */
export function offscreenMarkers(
	centres: readonly { x: number; y: number }[],
	transform: ViewTransform,
	size: { width: number; height: number },
	card: { width: number; height: number }
): OffscreenMarker[] {
	const halfW = (card.width / 2) * transform.k;
	const halfH = (card.height / 2) * transform.k;
	const groups = new Map<
		EdgeDirection,
		{ count: number; overshoot: number; pan: { x: number; y: number } }
	>();

	for (const centre of centres) {
		const sx = transform.x + centre.x * transform.k;
		const sy = transform.y + centre.y * transform.k;
		const overLeft = -(sx + halfW);
		const overRight = sx - halfW - size.width;
		const overTop = -(sy + halfH);
		const overBottom = sy - halfH - size.height;
		const overshootX = Math.max(overLeft, overRight);
		const overshootY = Math.max(overTop, overBottom);
		if (overshootX < 0 && overshootY < 0) continue;

		const isHorizontal = overshootX >= overshootY;
		const direction = isHorizontal
			? overLeft > overRight
				? EDGE_DIRECTIONS.LEFT
				: EDGE_DIRECTIONS.RIGHT
			: overTop > overBottom
				? EDGE_DIRECTIONS.UP
				: EDGE_DIRECTIONS.DOWN;
		const overshoot = isHorizontal ? overshootX : overshootY;
		const pan = {
			x: overshootX >= 0 ? size.width / 2 - sx : 0,
			y: overshootY >= 0 ? size.height / 2 - sy : 0
		};

		const group = groups.get(direction);
		if (!group) groups.set(direction, { count: 1, overshoot, pan });
		else {
			group.count += 1;
			if (overshoot < group.overshoot) {
				group.overshoot = overshoot;
				group.pan = pan;
			}
		}
	}

	return DIRECTION_ORDER.flatMap((direction) => {
		const group = groups.get(direction);
		return group ? [{ direction, count: group.count, pan: group.pan }] : [];
	});
}

const DIRECTION_PHRASES: Record<EdgeDirection, string> = {
	left: 'to the left',
	right: 'to the right',
	up: 'above',
	down: 'below'
};

/** The accessible name of a marker, which also says what activating it does. */
export function markerLabel(marker: Pick<OffscreenMarker, 'direction' | 'count'>): string {
	const noun = marker.count === 1 ? 'relative' : 'relatives';
	return `${marker.count} ${noun} ${DIRECTION_PHRASES[marker.direction]}, show them`;
}

export const FIT_ACTIONS = { FRAME: 'frame', WHOLE: 'whole' } as const;
export type FitAction = (typeof FIT_ACTIONS)[keyof typeof FIT_ACTIONS];

/**
 * What the next press of Fit does. Where the whole tree is unreadable, the first press goes to the
 * readable framing and the next one, from there, shows the whole tree. Everywhere else Fit means
 * the whole tree, as it always did.
 */
export function chooseFitAction(state: {
	/** The canvas is narrow and the whole tree would not stay readable on it. */
	isWholeUnreadable: boolean;
	/** The view is already at the readable framing. */
	isAtFrame: boolean;
}): FitAction {
	if (!state.isWholeUnreadable) return FIT_ACTIONS.WHOLE;
	return state.isAtFrame ? FIT_ACTIONS.WHOLE : FIT_ACTIONS.FRAME;
}

/** Whether two views are close enough that a person would call them the same framing. */
export function isNearTransform(
	a: ViewTransform,
	b: ViewTransform,
	tolerance = { pixels: 12, scaleShare: 0.02 }
): boolean {
	return (
		Math.abs(a.k - b.k) <= b.k * tolerance.scaleShare &&
		Math.abs(a.x - b.x) <= tolerance.pixels &&
		Math.abs(a.y - b.y) <= tolerance.pixels
	);
}
