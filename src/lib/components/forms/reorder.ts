/** Pure parts of drag-to-reorder, kept apart from the pointer handling so they can be tested. */

/** A copy of `ids` with the item at `from` moved to `to`; out-of-range indexes return it unchanged. */
export function moveItem<T>(ids: readonly T[], from: number, to: number): T[] {
	const next = [...ids];
	if (from === to || from < 0 || to < 0 || from >= next.length || to >= next.length) return next;
	next.splice(to, 0, next.splice(from, 1)[0]!);
	return next;
}

/**
 * Where a dragged row would land: the number of the other rows whose centre lies above its centre.
 * `centres` are the rows' vertical centres in their resting order, the dragged row's included.
 */
export function dropIndex(centres: readonly number[], from: number, draggedCentre: number): number {
	return centres.filter((c, i) => i !== from && c < draggedCentre).length;
}
