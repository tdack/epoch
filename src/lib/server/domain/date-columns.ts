/**
 * The structured columns stored beside an event's verbatim `date_raw` (ADR-004). One function
 * derives them, so an edit, an import and the backfill script cannot disagree.
 */

import {
	CALENDARS,
	DATE_QUALIFIERS,
	parseDateValue,
	type Calendar,
	type DatePrecision,
	type DateQualifier,
	type DateValue
} from './date-value';

export interface EventDateColumns {
	/** Inclusive lower bound. Unchanged meaning from before ADR-004 was persisted. */
	dateSort: string | null;
	dateSortEnd: string | null;
	dateQualifier: DateQualifier | null;
	datePrecision: DatePrecision | null;
	dateCalendar: Calendar | null;
}

/** No date at all: every structured column is null, which is not the same as "not yet backfilled". */
const NO_DATE: EventDateColumns = {
	dateSort: null,
	dateSortEnd: null,
	dateQualifier: null,
	datePrecision: null,
	dateCalendar: null
};

/**
 * Columns for a date text. `1900` keeps year precision with bounds spanning the year, and
 * `ABT 1900` keeps its qualifier; neither becomes a day. Text that is not a date is stored with
 * `UNKNOWN` or `PHRASE` and no bounds, so it is distinguishable from a row nobody has looked at.
 */
export function dateColumnsFor(dateText: string | null | undefined): EventDateColumns {
	if (!dateText?.trim()) return { ...NO_DATE };
	const value = parseDateValue(dateText);
	return {
		dateSort: value.sortStart,
		dateSortEnd: value.sortEnd,
		dateQualifier: value.qualifier,
		datePrecision: value.precision,
		dateCalendar: value.calendar
	};
}

interface StoredDate extends EventDateColumns {
	dateRaw: string | null;
}

/**
 * The event's date as a value object. Uses the stored columns, and parses `date_raw` for a row
 * from before they existed, so reading never depends on the backfill having run.
 */
export function eventDateValue(row: StoredDate): DateValue {
	if (!row.dateQualifier || !row.datePrecision) return parseDateValue(row.dateRaw);
	return {
		raw: row.dateRaw?.trim() ?? '',
		qualifier: row.dateQualifier,
		precision: row.datePrecision,
		calendar: row.dateCalendar ?? CALENDARS.UNKNOWN,
		sortStart: row.dateSort,
		sortEnd: row.dateSortEnd,
		isApproximate:
			row.dateQualifier === DATE_QUALIFIERS.ABOUT ||
			row.dateQualifier === DATE_QUALIFIERS.ESTIMATED ||
			row.dateQualifier === DATE_QUALIFIERS.CALCULATED ||
			row.dateQualifier === DATE_QUALIFIERS.BETWEEN ||
			row.dateQualifier === DATE_QUALIFIERS.FROM_TO ||
			row.dateQualifier === DATE_QUALIFIERS.PHRASE
	};
}
