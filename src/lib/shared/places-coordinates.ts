/**
 * GEDCOM coordinates (`LATI`/`LONG`), as a fact stores them: `N18.150944`, `S37.5622`, `E143.8503`,
 * `W0.1278`. Migration 0047 and the importer parse the same text in SQL; place-locations.test.ts
 * holds the two to the same answers.
 */

export type CoordinateAxis = 'latitude' | 'longitude';

const LIMITS: Record<CoordinateAxis, number> = { latitude: 90, longitude: 180 };
const LETTERS: Record<CoordinateAxis, { positive: string; negative: string }> = {
	latitude: { positive: 'N', negative: 'S' },
	longitude: { positive: 'E', negative: 'W' }
};
/** Digits with at most one point. Not `Number()`, which also takes `1e3`, `0x10` and `Infinity`. */
const DECIMAL = /^(?:\d+\.?\d*|\.\d+)$/;

/**
 * Decimal degrees for a GEDCOM coordinate, or null when it is not one. A letter must belong to the
 * axis (`E` on a latitude is a swapped pair, and guessing would put the place on the wrong
 * continent); a bare decimal may carry a sign. Out of range is null, never clamped.
 */
export function parseGedcomCoordinate(value: string, axis: CoordinateAxis): number | null {
	const text = value.trim();
	const first = text.charAt(0).toUpperCase();
	const { positive, negative } = LETTERS[axis];
	let sign = 1;
	let digits = text;
	if (first === positive || first === '+') digits = text.slice(1);
	else if (first === negative || first === '-') {
		sign = -1;
		digits = text.slice(1);
	}
	if (!DECIMAL.test(digits)) return null;
	const degrees = sign * Number(digits);
	return Math.abs(degrees) <= LIMITS[axis] ? degrees : null;
}
