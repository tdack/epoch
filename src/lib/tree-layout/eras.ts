/**
 * Era estimation for the Ball view: one calendar year per drawn person, used only to choose a
 * height. Recorded dates anchor it and bonds between people fill the gaps, so a partner with no
 * dates of their own lands beside the partner who has them rather than in the 1700s.
 *
 * Eras are layout values. Nothing here is shown as a date, and the original date text is never
 * rewritten: `ABT 1900` stays a range, and only its midpoint is read.
 */

import { parseDateValue } from '#lib/shared/date-value.js';

/** A child is born about this long after a parent, within the clamp below. */
const PARENT_GAP_YEARS = 28;
const PARENT_GAP_MIN_YEARS = 15;
const PARENT_GAP_MAX_YEARS = 55;
/** Partners are about the same age, within this much either way. */
const PARTNER_GAP_MAX_YEARS = 20;
/** Birth is estimated this far before a death date when only the death is recorded. */
const TYPICAL_LIFESPAN_YEARS = 70;
/** Where a tree with no dates at all is centred; any constant keeps the layout deterministic. */
const NOMINAL_FOCUS_YEAR = 2000;
const MAX_ITERATIONS = 200;
const TOLERANCE_YEARS = 0.01;

export interface EraPerson {
	id: string;
	/** Rows relative to the focus, for the fallback when a component has no dates. */
	generation: number;
	birthDate?: string | null;
	deathDate?: string | null;
	/** A private person's dates are never read, so nothing about them reaches anyone's height. */
	isPrivate?: boolean;
}

export interface EraBonds {
	parentChild: Array<{ parentId: string; childId: string }>;
	partners: Array<[string, string]>;
}

export interface EraEstimate {
	/** Years, fractional. Defined for every person passed in. */
	eras: Map<string, number>;
	/** People whose era comes from their own recorded date and never moves. */
	anchorIds: Set<string>;
	/** False when nobody has a usable date; the view then says its heights are only generations. */
	hasDates: boolean;
}

/** Midpoint of a date's lower and upper bounds as a fractional year; null when unbounded. */
function midYear(text: string | null | undefined): number | null {
	const value = parseDateValue(text);
	const toYear = (iso: string | null) => {
		if (!iso) return null;
		const m = /^(-?\d{1,6})-(\d{2})-(\d{2})/.exec(iso);
		return m ? Number(m[1]) + (Number(m[2]) - 1) / 12 + (Number(m[3]) - 1) / 365 : null;
	};
	const low = toYear(value.sortStart);
	const high = toYear(value.sortEnd);
	if (low !== null && high !== null) return (low + high) / 2;
	return low ?? high;
}

function knownEra(person: EraPerson): number | null {
	if (person.isPrivate === true) return null;
	const born = midYear(person.birthDate);
	if (born !== null) return born;
	const died = midYear(person.deathDate);
	return died === null ? null : died - TYPICAL_LIFESPAN_YEARS;
}

function clamp(value: number, low: number, high: number): number {
	return Math.min(high, Math.max(low, value));
}

/**
 * Anchors are people with a recorded date. Everyone else starts at the value their nearest anchor
 * implies, then each sweep moves them to the mean of what their parents, children and partners
 * imply, clamped to the plausible gaps. Sweeps stop at the tolerance or the iteration cap.
 */
export function estimateEras(people: EraPerson[], bonds: EraBonds): EraEstimate {
	const eras = new Map<string, number>();
	const anchorIds = new Set<string>();
	const parentsOf = new Map<string, string[]>();
	const childrenOf = new Map<string, string[]>();
	const partnersOf = new Map<string, string[]>();
	const push = (map: Map<string, string[]>, key: string, value: string) =>
		map.set(key, [...(map.get(key) ?? []), value]);
	const isKnown = new Set(people.map((p) => p.id));
	for (const { parentId, childId } of bonds.parentChild) {
		if (!isKnown.has(parentId) || !isKnown.has(childId)) continue;
		push(parentsOf, childId, parentId);
		push(childrenOf, parentId, childId);
	}
	for (const [a, b] of bonds.partners) {
		if (!isKnown.has(a) || !isKnown.has(b) || a === b) continue;
		push(partnersOf, a, b);
		push(partnersOf, b, a);
	}

	for (const person of people) {
		const era = knownEra(person);
		if (era === null) continue;
		eras.set(person.id, era);
		anchorIds.add(person.id);
	}
	const hasDates = anchorIds.size > 0;

	// Reached outward from the anchors, so far-off people start near where the sweeps will leave them.
	const queue = people.filter((p) => anchorIds.has(p.id)).map((p) => p.id);
	for (let head = 0; head < queue.length; head++) {
		const id = queue[head];
		const here = eras.get(id)!;
		const reach: Array<[string[] | undefined, number]> = [
			[childrenOf.get(id), PARENT_GAP_YEARS],
			[parentsOf.get(id), -PARENT_GAP_YEARS],
			[partnersOf.get(id), 0]
		];
		for (const [others, offset] of reach)
			for (const other of others ?? [])
				if (!eras.has(other)) {
					eras.set(other, here + offset);
					queue.push(other);
				}
	}

	// People in a component without a single date: generations around the shared focus year.
	const anchoredYears = people
		.filter((p) => anchorIds.has(p.id))
		.map((p) => eras.get(p.id)! - p.generation * PARENT_GAP_YEARS);
	const focusYear = hasDates
		? anchoredYears.reduce((sum, y) => sum + y, 0) / anchoredYears.length
		: NOMINAL_FOCUS_YEAR;
	const fallback = (p: EraPerson) => focusYear + p.generation * PARENT_GAP_YEARS;
	const isFree = new Set<string>();
	for (const p of people) {
		if (anchorIds.has(p.id)) continue;
		isFree.add(p.id);
		if (!eras.has(p.id)) eras.set(p.id, fallback(p));
	}

	const movable = people.filter((p) => isFree.has(p.id));
	for (let sweep = 0; sweep < MAX_ITERATIONS; sweep++) {
		let largestMove = 0;
		for (const p of movable) {
			const implied: number[] = [];
			const parents = parentsOf.get(p.id) ?? [];
			const children = childrenOf.get(p.id) ?? [];
			const partners = partnersOf.get(p.id) ?? [];
			for (const o of parents) implied.push(eras.get(o)! + PARENT_GAP_YEARS);
			for (const o of children) implied.push(eras.get(o)! - PARENT_GAP_YEARS);
			for (const o of partners) implied.push(eras.get(o)!);
			if (implied.length === 0) continue;
			let next = implied.reduce((sum, y) => sum + y, 0) / implied.length;
			for (const o of parents)
				next = clamp(
					next,
					eras.get(o)! + PARENT_GAP_MIN_YEARS,
					eras.get(o)! + PARENT_GAP_MAX_YEARS
				);
			for (const o of children)
				next = clamp(
					next,
					eras.get(o)! - PARENT_GAP_MAX_YEARS,
					eras.get(o)! - PARENT_GAP_MIN_YEARS
				);
			for (const o of partners)
				next = clamp(
					next,
					eras.get(o)! - PARTNER_GAP_MAX_YEARS,
					eras.get(o)! + PARTNER_GAP_MAX_YEARS
				);
			largestMove = Math.max(largestMove, Math.abs(next - eras.get(p.id)!));
			eras.set(p.id, next);
		}
		if (largestMove < TOLERANCE_YEARS) break;
	}
	return { eras, anchorIds, hasDates };
}
