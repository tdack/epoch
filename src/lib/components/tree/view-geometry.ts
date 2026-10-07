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
	/**
	 * Left and right markers only: the screen y (px from the canvas top) of the marker's centre,
	 * chosen to sit between the cards that show near that edge rather than on one.
	 */
	offset?: number;
}

/** Height a marker needs along its edge, with a gap each side; the touch size is the larger one. */
const MARKER_SPAN_PX = 52;
/** How far a left or right marker reaches in from its edge, including the inset. */
const MARKER_DEPTH_PX = 56;
/** Corners the chrome owns: the legend at the top left and the zoom bar at the bottom right. */
const RESERVED_TOP_PX = 64;
const RESERVED_BOTTOM_PX = 88;
const OFFSET_STEP_PX = 8;

/**
 * Where on a vertical edge a marker covers the least of the cards that show beside it. A card
 * under the marker loses its name, and the old fixed mid-height put it over whoever stood there.
 * Falls back to the middle when nothing is free, which is the position the marker always had.
 */
function clearOffset(
	side: 'left' | 'right',
	centres: readonly { x: number; y: number }[],
	transform: ViewTransform,
	size: { width: number; height: number },
	card: { width: number; height: number }
): number {
	const halfW = (card.width / 2) * transform.k;
	const halfH = (card.height / 2) * transform.k;
	const bandStart = side === 'left' ? 0 : size.width - MARKER_DEPTH_PX;
	const bandEnd = bandStart + MARKER_DEPTH_PX;
	const covered: [number, number][] = [];
	for (const centre of centres) {
		const sx = transform.x + centre.x * transform.k;
		const sy = transform.y + centre.y * transform.k;
		const isInBand = sx + halfW > bandStart && sx - halfW < bandEnd;
		const isOnScreen = sy + halfH > 0 && sy - halfH < size.height;
		if (isInBand && isOnScreen) covered.push([sy - halfH, sy + halfH]);
	}

	const middle = size.height / 2;
	const lowest = RESERVED_TOP_PX + MARKER_SPAN_PX / 2;
	const highest = size.height - RESERVED_BOTTOM_PX - MARKER_SPAN_PX / 2;
	if (covered.length === 0 || highest < lowest) return middle;

	let best = middle;
	let bestOverlap = Infinity;
	for (let y = lowest; y <= highest; y += OFFSET_STEP_PX) {
		const top = y - MARKER_SPAN_PX / 2;
		const bottom = y + MARKER_SPAN_PX / 2;
		const overlap = covered.reduce(
			(sum, [from, to]) => sum + Math.max(0, Math.min(bottom, to) - Math.max(top, from)),
			0
		);
		const isBetter =
			overlap < bestOverlap ||
			(overlap === bestOverlap && Math.abs(y - middle) < Math.abs(best - middle));
		if (isBetter) {
			best = y;
			bestOverlap = overlap;
		}
	}
	return best;
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
		if (!group) return [];
		const isSide = direction === EDGE_DIRECTIONS.LEFT || direction === EDGE_DIRECTIONS.RIGHT;
		return [
			{
				direction,
				count: group.count,
				pan: group.pan,
				...(isSide ? { offset: clearOffset(direction, centres, transform, size, card) } : {})
			}
		];
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
