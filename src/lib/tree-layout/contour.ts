/**
 * Per-row horizontal extents of a placed subtree, relative to the subtree's reference x. Placing
 * neighbours by comparing contours row by row (rather than one bounding width) is what lets a
 * wide family sit next to a narrow one without wasted space and without overlaps.
 */

export type Contour = Map<number, [left: number, right: number]>;

export function contourAdd(contour: Contour, row: number, left: number, right: number): void {
	const existing = contour.get(row);
	if (!existing) contour.set(row, [left, right]);
	else contour.set(row, [Math.min(existing[0], left), Math.max(existing[1], right)]);
}

export function contourMerge(target: Contour, source: Contour, dx: number): void {
	for (const [row, [l, r]] of source) contourAdd(target, row, l + dx, r + dx);
}

/**
 * Smallest offset of `next`'s reference x from `placed`'s so that no row overlaps and every
 * shared row keeps `gap` between them. -Infinity when the two share no row.
 */
export function contourSeparation(placed: Contour, next: Contour, gap: number): number {
	let separation = Number.NEGATIVE_INFINITY;
	for (const [row, [, right]] of placed) {
		const other = next.get(row);
		if (other) separation = Math.max(separation, right - other[0] + gap);
	}
	return separation;
}
