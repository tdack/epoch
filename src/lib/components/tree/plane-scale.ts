/**
 * What keeps the 3D views cheap on a big tree: which planes are worth drawing for the current pan
 * and zoom, and which cards on a crowded back row fold into a "+N" mark. Pure, so the budgets are
 * tested without a browser (ADR-030).
 */

export interface ScreenBox {
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
}

/**
 * Whether a plane's projected box can reach the canvas. `transform` is the 2D pan and zoom around
 * the stage. The projection leaves perspective out (see `projectToScreen`), so a near plane draws a
 * little larger than the box says; `marginPx` absorbs that and lets a plane mount just before a
 * pan brings it in.
 */
export function isBoxInView(
	box: ScreenBox,
	transform: { x: number; y: number; k: number },
	size: { width: number; height: number },
	marginPx: number
): boolean {
	const left = box.minX * transform.k + transform.x;
	const right = box.maxX * transform.k + transform.x;
	const top = box.minY * transform.k + transform.y;
	const bottom = box.maxY * transform.k + transform.y;
	return (
		right >= -marginPx &&
		left <= size.width + marginPx &&
		bottom >= -marginPx &&
		top <= size.height + marginPx
	);
}

export interface FoldItem {
	id: string;
	/** The plane or band of the row; row 0 is never folded. */
	group: number;
	generation: number;
	x: number;
}

/** A run of folded cards that stands in for them on their row. */
export interface FoldMark {
	/** Stable for the same run, so the mark keeps its element across redraws. */
	id: string;
	/** The row it belongs to; opening it unfolds every run on that row. */
	rowKey: string;
	group: number;
	generation: number;
	x: number;
	count: number;
}

export function rowKeyOf(group: number, generation: number): string {
	return `${group}:${generation}`;
}

/**
 * Fold the cards of crowded back rows. A row with more than `limit` cards keeps the ones nearest
 * `centreX` (and every protected one, such as the focus, the cursor and the open drawer) and
 * replaces each run of the others with one mark where the run stood. Row 0, rows that fit, and
 * rows the viewer has opened are left alone.
 */
export function foldWideRows(
	items: readonly FoldItem[],
	options: {
		limit: number;
		centreX: number;
		protectedIds: ReadonlySet<string>;
		openRowKeys: ReadonlySet<string>;
	}
): { hiddenIds: Set<string>; marks: FoldMark[] } {
	const hiddenIds = new Set<string>();
	const marks: FoldMark[] = [];
	const rows = new Map<string, FoldItem[]>();
	for (const item of items) {
		if (item.group < 1) continue;
		const key = rowKeyOf(item.group, item.generation);
		rows.set(key, [...(rows.get(key) ?? []), item]);
	}
	for (const [rowKey, row] of rows) {
		if (row.length <= options.limit || options.openRowKeys.has(rowKey)) continue;
		const byX = [...row].sort((a, b) => a.x - b.x || (a.id < b.id ? -1 : 1));
		const keptIds = new Set(options.protectedIds);
		const nearest = [...byX].sort(
			(a, b) =>
				Math.abs(a.x - options.centreX) - Math.abs(b.x - options.centreX) || (a.id < b.id ? -1 : 1)
		);
		for (const item of nearest) {
			if (keptIds.size >= options.limit) break;
			keptIds.add(item.id);
		}
		let run: FoldItem[] = [];
		const close = () => {
			if (run.length === 0) return;
			marks.push({
				id: `${rowKey}#${run[0].id}`,
				rowKey,
				group: run[0].group,
				generation: run[0].generation,
				x: (run[0].x + run[run.length - 1].x) / 2,
				count: run.length
			});
			run = [];
		};
		for (const item of byX) {
			if (keptIds.has(item.id)) close();
			else {
				hiddenIds.add(item.id);
				run.push(item);
			}
		}
		close();
	}
	return { hiddenIds, marks };
}
