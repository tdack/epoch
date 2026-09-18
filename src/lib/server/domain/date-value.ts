/**
 * Historical date value object.
 *
 * Genealogy dates are frequently incomplete (`1910`, `MAY 1920`), approximate
 * (`ABT 1845`), ranged (`BET 1860 AND 1865`), or phrased (`(about 1900)`).
 * Converting any of these into a fabricated exact day (e.g. `1910-01-01`)
 * destroys historical accuracy, so this module retains the verbatim text and
 * only derives inclusive sort bounds for indexing and chronological filtering.
 */

export const DATE_QUALIFIERS = {
	EXACT: 'EXACT',
	ABOUT: 'ABOUT',
	ESTIMATED: 'ESTIMATED',
	CALCULATED: 'CALCULATED',
	BEFORE: 'BEFORE',
	AFTER: 'AFTER',
	BETWEEN: 'BETWEEN',
	FROM_TO: 'FROM_TO',
	PHRASE: 'PHRASE',
	UNKNOWN: 'UNKNOWN'
} as const;
export type DateQualifier = (typeof DATE_QUALIFIERS)[keyof typeof DATE_QUALIFIERS];

export const DATE_PRECISIONS = {
	DAY: 'DAY',
	MONTH: 'MONTH',
	YEAR: 'YEAR',
	NONE: 'NONE'
} as const;
export type DatePrecision = (typeof DATE_PRECISIONS)[keyof typeof DATE_PRECISIONS];

export const CALENDARS = {
	GREGORIAN: 'GREGORIAN',
	JULIAN: 'JULIAN',
	HEBREW: 'HEBREW',
	FRENCH_REPUBLICAN: 'FRENCH_REPUBLICAN',
	UNKNOWN: 'UNKNOWN'
} as const;
export type Calendar = (typeof CALENDARS)[keyof typeof CALENDARS];

export interface DateValue {
	/** Verbatim text from the historical record or user entry. */
	raw: string;
	qualifier: DateQualifier;
	precision: DatePrecision;
	calendar: Calendar;
	/** Inclusive lower sort bound in `YYYY-MM-DD`, or null when unbounded. */
	sortStart: string | null;
	/** Inclusive upper sort bound in `YYYY-MM-DD`, or null when unbounded. */
	sortEnd: string | null;
	/** True when the qualifier marks the date as approximate rather than exact. */
	isApproximate: boolean;
}

const MONTHS: Record<string, number> = {
	JAN: 1,
	FEB: 2,
	MAR: 3,
	APR: 4,
	MAY: 5,
	JUN: 6,
	JUL: 7,
	AUG: 8,
	SEP: 9,
	OCT: 10,
	NOV: 11,
	DEC: 12
};

const MONTH_NAMES: Record<string, number> = {
	JANUARY: 1,
	FEBRUARY: 2,
	MARCH: 3,
	APRIL: 4,
	MAY: 5,
	JUNE: 6,
	JULY: 7,
	AUGUST: 8,
	SEPTEMBER: 9,
	OCTOBER: 10,
	NOVEMBER: 11,
	DECEMBER: 12
};

function pad(n: number): string {
	return n.toString().padStart(2, '0');
}

function daysInMonth(year: number, month: number): number {
	// Month is 1-based; day 0 of the next month is the last day of this month.
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isoDate(year: number, month: number, day: number): string {
	return `${year.toString().padStart(4, '0')}-${pad(month)}-${pad(day)}`;
}

function addDays(iso: string, days: number): string {
	const [y, m, d] = iso.split('-').map(Number);
	const date = new Date(Date.UTC(y, m - 1, d + days));
	return isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

interface ParsedDateParts {
	year: number;
	month: number | null;
	day: number | null;
}

function parseMonth(token: string): number | null {
	return MONTHS[token.toUpperCase()] ?? MONTH_NAMES[token.toUpperCase()] ?? null;
}

/**
 * Parse a single (non-ranged) date token into its numeric parts.
 * Accepts `DD MMM YYYY`, `MMM YYYY`, and `YYYY` forms.
 */
function parseDateParts(token: string): ParsedDateParts | null {
	const trimmed = token.trim();
	const dayMonthYear = trimmed.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{3,4})$/);
	if (dayMonthYear) {
		const month = parseMonth(dayMonthYear[2]);
		if (month === null) return null;
		return { year: Number(dayMonthYear[3]), month, day: Number(dayMonthYear[1]) };
	}

	const monthYear = trimmed.match(/^([A-Za-z]{3,9})\s+(\d{3,4})$/);
	if (monthYear) {
		const month = parseMonth(monthYear[1]);
		if (month === null) return null;
		return { year: Number(monthYear[2]), month, day: null };
	}

	const yearOnly = trimmed.match(/^(\d{3,4})$/);
	if (yearOnly) {
		return { year: Number(yearOnly[1]), month: null, day: null };
	}

	return null;
}

function boundsForParts(parts: ParsedDateParts): { start: string; end: string } {
	if (parts.day !== null && parts.month !== null) {
		const iso = isoDate(parts.year, parts.month, parts.day);
		return { start: iso, end: iso };
	}
	if (parts.month !== null) {
		const last = daysInMonth(parts.year, parts.month);
		return {
			start: isoDate(parts.year, parts.month, 1),
			end: isoDate(parts.year, parts.month, last)
		};
	}
	return { start: isoDate(parts.year, 1, 1), end: isoDate(parts.year, 12, 31) };
}

function precisionForParts(parts: ParsedDateParts): DatePrecision {
	if (parts.day !== null) return DATE_PRECISIONS.DAY;
	if (parts.month !== null) return DATE_PRECISIONS.MONTH;
	return DATE_PRECISIONS.YEAR;
}

const PRECISION_ORDER: Record<DatePrecision, number> = {
	[DATE_PRECISIONS.NONE]: 0,
	[DATE_PRECISIONS.YEAR]: 1,
	[DATE_PRECISIONS.MONTH]: 2,
	[DATE_PRECISIONS.DAY]: 3
};

function maxPrecision(a: DatePrecision, b: DatePrecision): DatePrecision {
	return PRECISION_ORDER[a] >= PRECISION_ORDER[b] ? a : b;
}

/**
 * Parse a GEDCOM-style date string into a {@link DateValue}.
 *
 * Never fabricates an exact day from a partial date: `1900` yields year
 * precision with `1900-01-01`..`1900-12-31` bounds, and `ABT 1900` keeps its
 * approximate qualifier rather than collapsing to a false exact day.
 */
export function parseDateValue(rawInput: string | null | undefined): DateValue {
	const raw = rawInput?.trim() ?? '';
	if (!raw) {
		return {
			raw: '',
			qualifier: DATE_QUALIFIERS.UNKNOWN,
			precision: DATE_PRECISIONS.NONE,
			calendar: CALENDARS.UNKNOWN,
			sortStart: null,
			sortEnd: null,
			isApproximate: false
		};
	}

	// Phrase dates are parenthesised free text with no sortable value.
	if (raw.startsWith('(') && raw.endsWith(')')) {
		return {
			raw,
			qualifier: DATE_QUALIFIERS.PHRASE,
			precision: DATE_PRECISIONS.NONE,
			calendar: CALENDARS.UNKNOWN,
			sortStart: null,
			sortEnd: null,
			isApproximate: true
		};
	}

	const upper = raw.toUpperCase();

	// Dual dates (e.g. `15 JAN 1900/01`) carry a Julian/Gregorian pair; sort on
	// the first (Gregorian) component and record the calendar as JULIAN.
	const dual = upper.match(/^(.+?)\s*\/\s*(\d{1,2})$/);
	const calendar = dual ? CALENDARS.JULIAN : CALENDARS.GREGORIAN;
	const body = dual ? dual[1].trim() : raw;

	// Ranged qualifiers.
	const between = body.match(/^BET(?:WEEN)?\s+(.+?)\s+AND\s+(.+)$/);
	if (between) {
		const startParts = parseDateParts(between[1]);
		const endParts = parseDateParts(between[2]);
		if (startParts && endParts) {
			return {
				raw,
				qualifier: DATE_QUALIFIERS.BETWEEN,
				precision: precisionForParts(startParts),
				calendar,
				sortStart: boundsForParts(startParts).start,
				sortEnd: boundsForParts(endParts).end,
				isApproximate: true
			};
		}
	}

	const fromTo = body.match(/^FROM\s+(.+?)\s+TO\s+(.+)$/);
	if (fromTo) {
		const startParts = parseDateParts(fromTo[1]);
		const endParts = parseDateParts(fromTo[2]);
		if (startParts && endParts) {
			return {
				raw,
				qualifier: DATE_QUALIFIERS.FROM_TO,
				precision: maxPrecision(precisionForParts(startParts), precisionForParts(endParts)),
				calendar,
				sortStart: boundsForParts(startParts).start,
				sortEnd: boundsForParts(endParts).end,
				isApproximate: true
			};
		}
	}

	// Single-value qualifiers.
	const single = body.match(/^(ABT|ABOUT|EST|ESTIMATED|CAL|CALCULATED|BEF|BEFORE|AFT|AFTER|INT)\s+(.+)$/);
	let qualifier: DateQualifier = DATE_QUALIFIERS.EXACT;
	let dateBody = body;
	if (single) {
		const prefix = single[1];
		dateBody = single[2];
		if (prefix === 'ABT' || prefix === 'ABOUT') qualifier = DATE_QUALIFIERS.ABOUT;
		else if (prefix === 'EST' || prefix === 'ESTIMATED') qualifier = DATE_QUALIFIERS.ESTIMATED;
		else if (prefix === 'CAL' || prefix === 'CALCULATED') qualifier = DATE_QUALIFIERS.CALCULATED;
		else if (prefix === 'BEF' || prefix === 'BEFORE') qualifier = DATE_QUALIFIERS.BEFORE;
		else if (prefix === 'AFT' || prefix === 'AFTER') qualifier = DATE_QUALIFIERS.AFTER;
		// INT (interpreted) is a real date; treat as exact.
	}

	const parts = parseDateParts(dateBody);
	if (!parts) {
		return {
			raw,
			qualifier: DATE_QUALIFIERS.UNKNOWN,
			precision: DATE_PRECISIONS.NONE,
			calendar,
			sortStart: null,
			sortEnd: null,
			isApproximate: false
		};
	}

	const bounds = boundsForParts(parts);
	let sortStart: string | null = bounds.start;
	let sortEnd: string | null = bounds.end;

	if (qualifier === DATE_QUALIFIERS.BEFORE) {
		// Exclusive: everything strictly before the given date.
		sortStart = null;
		sortEnd = addDays(bounds.start, -1);
	} else if (qualifier === DATE_QUALIFIERS.AFTER) {
		sortStart = addDays(bounds.end, 1);
		sortEnd = null;
	}

	return {
		raw,
		qualifier,
		precision: precisionForParts(parts),
		calendar,
		sortStart,
		sortEnd,
		isApproximate:
			qualifier === DATE_QUALIFIERS.ABOUT ||
			qualifier === DATE_QUALIFIERS.ESTIMATED ||
			qualifier === DATE_QUALIFIERS.CALCULATED
	};
}