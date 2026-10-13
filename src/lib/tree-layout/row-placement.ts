/**
 * Placement along one row of the `layers` view. The hourglass gives most people an x; a view that
 * splits a generation into planes then needs to close the holes the split leaves, and to find a
 * place for people the hourglass has no slot for (aunts, cousins and a partner's family)
 * (ADR-030).
 */

import type { LayoutMetrics } from './types.js';

export interface RowItem {
	key: string;
	x: number;
	width: number;
	generation: number;
	/** The band or plane the item belongs to; each (generation, group) is its own row. */
	group: number;
}

/** A thing already standing in a row, which a newcomer must keep clear of. */
export interface Standing {
	key: string;
	x: number;
	width: number;
}

/**
 * New x for every row item. Walking each (generation, group) row left to right, a gap that held
 * other groups' cards in the flat row shrinks by the width those cards took, never below the
 * spacing flat already uses between neighbours. Gaps that held nothing foreign stay as they were,
 * which keeps children under their parents wherever the groups agree.
 */
export function compactRows(
	items: RowItem[],
	groups: readonly number[],
	partnerPairs: ReadonlySet<string>,
	m: LayoutMetrics
): Map<string, number> {
	const moved = new Map<string, number>();
	const byGeneration = new Map<number, RowItem[]>();
	for (const item of items) {
		const list = byGeneration.get(item.generation) ?? [];
		list.push(item);
		byGeneration.set(item.generation, list);
	}
	for (const flatRow of byGeneration.values()) {
		flatRow.sort((a, b) => a.x - b.x || (a.key < b.key ? -1 : 1));
		for (const group of groups) {
			const row = flatRow.filter((i) => i.group === group);
			let shift = 0;
			row.forEach((item, i) => {
				if (i > 0) {
					const prev = row[i - 1];
					const gap = item.x - prev.x;
					const natural =
						(prev.width + item.width) / 2 + gapBetween(prev.key, item.key, partnerPairs, m);
					let foreign = 0;
					for (const other of flatRow) {
						if (other.group !== group && other.x > prev.x && other.x < item.x) {
							foreign += other.width + m.siblingGap;
						}
					}
					const target = Math.max(natural, gap - foreign);
					shift -= Math.max(0, gap - target);
				}
				moved.set(item.key, item.x + shift);
			});
		}
	}
	return moved;
}

/** The clear space two neighbours keep: a partner pair leaves room for its union node. */
function gapBetween(
	a: string,
	b: string,
	partnerPairs: ReadonlySet<string>,
	m: LayoutMetrics
): number {
	return partnerPairs.has(pairKey(a, b)) ? m.partnerGap : m.siblingGap;
}

export function pairKey(a: string, b: string): string {
	return [a, b].sort().join('|');
}

/**
 * The free x nearest `desired` for something `width` wide. Candidates are `desired` itself and the
 * spots just left and right of everything standing, so a newcomer lands beside the thing it
 * belongs to when there is room and as near as it can get when there is not. Ties go left, so the
 * answer never depends on input order.
 */
export function nearestFreeX(
	standing: readonly Standing[],
	key: string,
	width: number,
	desired: number,
	partnerPairs: ReadonlySet<string>,
	m: LayoutMetrics
): number {
	const room = (other: Standing) =>
		(other.width + width) / 2 + gapBetween(other.key, key, partnerPairs, m);
	const isFree = (x: number) =>
		standing.every((other) => Math.abs(other.x - x) >= room(other) - 1e-6);
	const candidates = [desired];
	for (const other of standing) candidates.push(other.x - room(other), other.x + room(other));
	let best = Number.NaN;
	for (const x of candidates) {
		if (!isFree(x)) continue;
		const isCloser = Number.isNaN(best) || Math.abs(x - desired) < Math.abs(best - desired) - 1e-9;
		const isTie =
			!Number.isNaN(best) && Math.abs(Math.abs(x - desired) - Math.abs(best - desired)) <= 1e-9;
		if (isCloser || (isTie && x < best)) best = x;
	}
	return best;
}
