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
		const year = Number(dayMonthYear[3]);
		const day = Number(dayMonthYear[1]);
		// `31 FEB 1900` would otherwise roll into March in the sort bounds.
		if (day < 1 || day > daysInMonth(year, month)) return null;
		return { year, month, day };
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

/** A date followed by the last digits of its later year: `30 JAN 1648/49`. */
const DUAL_DATE = /^(.+?)\s*\/\s*(\d{1,2})$/;

/**
 * Replace the year that ends `body` with the later year of a dual date, read from its last digits:
 * `1648` and `49` give `1649`, and `1699` and `00` roll the century over to `1700`.
 */
function withLaterDualYear(body: string, suffix: string): string {
	const year = body.match(/(\d{3,4})$/);
	if (!year) return body;
	const first = Number(year[1]);
	const modulus = 10 ** suffix.length;
	let later = first - (first % modulus) + Number(suffix);
	if (later <= first) later += modulus;
	return body.slice(0, year.index) + later;
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

	// Dual dates (e.g. `30 JAN 1648/49`) carry the year twice: the first is the Old Style year,
	// which began on 25 March, and the suffix is the year as reckoned from 1 January. Sort on the
	// later one, as GEDCOM 7.0 does when it writes the same date as `30 JAN 1649`; sorting on the
	// first put every January-to-March date a year early. The calendar is recorded as JULIAN.
	const dual = upper.match(DUAL_DATE);
	const calendar = dual ? CALENDARS.JULIAN : CALENDARS.GREGORIAN;
	const body = dual ? withLaterDualYear(dual[1].trim(), dual[2]) : raw;

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
	const single = body.match(
		/^(ABT|ABOUT|EST|ESTIMATED|CAL|CALCULATED|BEF|BEFORE|AFT|AFTER|INT)\s+(.+)$/
	);
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

/** GEDCOM month abbreviations in calendar order. */
export const MONTH_ABBREVIATIONS = Object.keys(MONTHS);

export interface DateInputCheck {
	isValid: boolean;
	/** Why the text was refused, in words a person can act on. */
	message?: string;
}

const DATE_FORMAT_HELP =
	'Use 14 APR 1912, APR 1912 or 1912, optionally after ABT, BEF, AFT, or as BET 1900 AND 1905. Put free text in brackets.';

/**
 * Check what a person typed into a date field. The parser deliberately keeps unreadable text
 * verbatim so imports never lose data; this is the stricter question a form asks before saving.
 */
export function checkDateText(rawInput: string | null | undefined): DateInputCheck {
	const raw = rawInput?.trim() ?? '';
	if (!raw) return { isValid: true };
	if (raw.startsWith('(') && raw.endsWith(')')) return { isValid: true };

	// Two-digit years are refused rather than guessed: 26 could be 1826, 1926 or 2026.
	if (/[A-Za-z]{3,9}\s+\d{1,2}$/.test(raw)) {
		return {
			isValid: false,
			message: 'Enter the full year, such as 1926. Two-digit years are ambiguous.'
		};
	}
	// A dual date's day is checked against its later year, the one it sorts on: `29 FEB 1647/48`.
	const dual = raw.match(DUAL_DATE);
	const dayText = dual ? withLaterDualYear(dual[1].trim(), dual[2]) : raw;
	if (/\b\d{1,2}\s+[A-Za-z]{3,9}\s+\d{3,4}\b/.test(dayText)) {
		const dayMonthYear = [...dayText.matchAll(/\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{3,4})\b/g)];
		for (const [, day, monthName, year] of dayMonthYear) {
			const month = parseMonth(monthName);
			if (month !== null && Number(day) > daysInMonth(Number(year), month)) {
				return {
					isValid: false,
					message: `${monthName.toUpperCase()} ${year} doesn't have a day ${Number(day)}.`
				};
			}
		}
	}

	const value = parseDateValue(raw);
	if (value.qualifier === DATE_QUALIFIERS.UNKNOWN) {
		return { isValid: false, message: `Not a date Epoch can read. ${DATE_FORMAT_HELP}` };
	}
	if (value.sortStart && value.sortEnd && value.sortStart > value.sortEnd) {
		return { isValid: false, message: 'The range ends before it starts.' };
	}
	return { isValid: true };
}

export interface PickerDate {
	year: number;
	/** 1-12, or null for a year-only date. */
	month: number | null;
	/** 1-31, or null when the day is not known. */
	day: number | null;
}

/** Days in a 1-based month; exposed so a picker can draw its grid from the same rule as validation. */
export function daysInMonthOf(year: number, month: number): number {
	return daysInMonth(year, month);
}

/**
 * Read the single date a picker can edit from field text, along with any leading qualifier
 * (`ABT `) to keep when the picker writes the date back. Ranges have two dates, so the picker
 * starts empty rather than choosing one to overwrite.
 */
export function pickerStateOf(rawInput: string): { date: PickerDate | null; prefix: string } {
	const raw = rawInput.trim();
	const single = raw.match(
		/^(ABT|ABOUT|EST|ESTIMATED|CAL|CALCULATED|BEF|BEFORE|AFT|AFTER|INT)\s+(.+)$/i
	);
	const prefix = single ? `${single[1].toUpperCase()} ` : '';
	const parts = parseDateParts(single ? single[2] : raw);
	return { date: parts, prefix };
}

/** Write a picked date the way the rest of the app stores it: `14 APR 1912`, `APR 1912` or `1912`. */
export function formatPickerDate(date: PickerDate): string {
	const year = date.year.toString();
	if (date.month === null) return year;
	const month = MONTH_ABBREVIATIONS[date.month - 1];
	return date.day === null ? `${month} ${year}` : `${date.day} ${month} ${year}`;
}
