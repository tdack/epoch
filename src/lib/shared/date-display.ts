/**
 * A date as a relative reads it: `ABT 1900` is "about 1900", `BET 1968 AND 1970` is "between 1968
 * and 1970". Display only. The stored text stays GEDCOM, and edit fields, search, sorting and export
 * keep using it (ADR-079).
 *
 * Text this cannot read is shown exactly as written, so nothing a person typed is ever lost or
 * reworded into something it did not say.
 */

import { parseDateParts, type ParsedDateParts } from './date-value';
import { tidyDateText } from './date-tidy';

/** A tree's choice of how dates read (ADR-079). Years always have four digits: a tree spans centuries. */
export const DATE_FORMATS = {
	/** 3 March 1900 */
	DAY_MONTH_YEAR: 'day_month_year',
	/** March 3, 1900 */
	MONTH_DAY_YEAR: 'month_day_year',
	/** 03 Mar 1900 */
	SHORT: 'short',
	/** 03/03/1900, month first */
	NUMERIC: 'numeric'
} as const;
export type DateFormat = (typeof DATE_FORMATS)[keyof typeof DATE_FORMATS];

export const DEFAULT_DATE_FORMAT: DateFormat = DATE_FORMATS.DAY_MONTH_YEAR;

export const DATE_FORMAT_LABELS: Readonly<Record<DateFormat, string>> = {
	[DATE_FORMATS.DAY_MONTH_YEAR]: '3 March 1900',
	[DATE_FORMATS.MONTH_DAY_YEAR]: 'March 3, 1900',
	[DATE_FORMATS.SHORT]: '03 Mar 1900',
	[DATE_FORMATS.NUMERIC]: '03/03/1900 (month first)'
};

export function isDateFormat(value: unknown): value is DateFormat {
	return Object.values(DATE_FORMATS).includes(value as DateFormat);
}

const MONTH_NAMES = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
] as const;

const pad = (n: number) => n.toString().padStart(2, '0');

function partsText({ year, month, day }: ParsedDateParts, format: DateFormat): string {
	const long = month === null ? null : MONTH_NAMES[month - 1];
	switch (format) {
		case DATE_FORMATS.MONTH_DAY_YEAR:
			if (long === null) return `${year}`;
			return day === null ? `${long} ${year}` : `${long} ${day}, ${year}`;
		case DATE_FORMATS.SHORT:
			if (long === null) return `${year}`;
			return day === null
				? `${long.slice(0, 3)} ${year}`
				: `${pad(day)} ${long.slice(0, 3)} ${year}`;
		case DATE_FORMATS.NUMERIC:
			if (month === null) return `${year}`;
			return day === null ? `${pad(month)}/${year}` : `${pad(month)}/${pad(day)}/${year}`;
		default:
			if (long === null) return `${year}`;
			return day === null ? `${long} ${year}` : `${day} ${long} ${year}`;
	}
}

/** One date, keeping a dual year as written: `30 JAN 1648/49` is "30 January 1648/49". */
function oneDate(token: string, format: DateFormat): string | null {
	const dual = token.match(/^(.*\S)\s*\/\s*(\d{1,2})$/);
	const parts = parseDateParts(dual ? dual[1] : token);
	if (!parts) return null;
	return dual ? `${partsText(parts, format)}/${dual[2]}` : partsText(parts, format);
}

const SINGLE_WORDS: Record<string, string> = {
	ABT: 'about',
	EST: 'estimated',
	CAL: 'calculated',
	BEF: 'before',
	AFT: 'after',
	// GEDCOM 7's open period: `TO 1900` is a period that ended then.
	TO: 'until',
	FROM: 'from'
};

/** The words for standard GEDCOM text, or null when it is not a date this can read. */
function words(text: string, format: DateFormat): string | null {
	const range = text.match(/^(BET|FROM)\s+(.*?\S)\s+(AND|TO)\s+(.+)$/i);
	if (range && (range[1].toUpperCase() === 'BET') === (range[3].toUpperCase() === 'AND')) {
		const start = oneDate(range[2], format);
		const end = oneDate(range[4], format);
		if (!start || !end) return null;
		return range[1].toUpperCase() === 'BET'
			? `between ${start} and ${end}`
			: `from ${start} to ${end}`;
	}
	// `INT` is a date with the person's own words for it, which are kept as written.
	const interpreted = text.match(/^INT\s+(.*?\S)\s*(\(.*\))$/i);
	if (interpreted) {
		const date = oneDate(interpreted[1], format);
		return date ? `${date} ${interpreted[2]}` : null;
	}
	const single = text.match(/^(ABT|EST|CAL|BEF|AFT|TO|FROM)\s+(.+)$/i);
	if (single) {
		const date = oneDate(single[2], format);
		return date ? `${SINGLE_WORDS[single[1].toUpperCase()]} ${date}` : null;
	}
	return oneDate(text, format);
}

/**
 * The date as words in the tree's format; empty for no date. A phrase in brackets is the person's
 * own words and loses only its brackets. Loosely typed text (`circa 1937`) is read through its
 * standard spelling, and anything still unreadable comes back unchanged.
 */
export function displayDate(
	rawInput: string | null | undefined,
	format: DateFormat = DEFAULT_DATE_FORMAT
): string {
	const raw = rawInput?.trim() ?? '';
	if (!raw) return '';
	if (raw.startsWith('(') && raw.endsWith(')')) return raw.slice(1, -1).trim();
	return words(raw, format) ?? words(tidyDateText(raw), format) ?? raw;
}
