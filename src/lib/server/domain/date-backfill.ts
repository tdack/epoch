import { dateColumnsFor } from './date-columns';

/** A table that stores a date in the ADR-004 columns, all named `<prefix>_raw`, `<prefix>_sort`, … */
export interface DatedTable {
	table: string;
	prefix: string;
}

/** Every table whose stored date columns `scripts/backfill-event-dates.mjs` keeps current. */
export const DATED_TABLES: readonly DatedTable[] = [
	{ table: 'events', prefix: 'date' },
	{ table: 'person_names', prefix: 'date' },
	{ table: 'citations', prefix: 'entry_date' }
];

/** A row's date text and its stored columns, under the `events` column names whatever the table. */
export interface StoredDateRow {
	id: string;
	date_raw: string;
	date_sort: string | null;
	date_sort_end: string | null;
	date_qualifier: string | null;
	date_precision: string | null;
	date_calendar: string | null;
}

/**
 * Rows that may be stale: dated with no structured columns yet (written before migration 0007),
 * or a dual date, which sorted on its earlier year until the parser was corrected. Only the
 * dual-date parse ever yields JULIAN, so the calendar finds exactly those rows.
 */
export function staleDatesSql({ table, prefix: p }: DatedTable): string {
	return (
		`SELECT id, ${p}_raw AS date_raw, ${p}_sort AS date_sort, ${p}_sort_end AS date_sort_end, ` +
		`${p}_qualifier AS date_qualifier, ${p}_precision AS date_precision, ` +
		`${p}_calendar AS date_calendar FROM ${table} ` +
		`WHERE ${p}_raw IS NOT NULL AND (${p}_qualifier IS NULL OR ${p}_calendar = 'JULIAN')`
	);
}

const quote = (value: string | null) =>
	value === null ? 'NULL' : `'${value.replaceAll("'", "''")}'`;

/**
 * One UPDATE per row whose columns differ from what `date_raw` now derives, so a second run finds
 * nothing to do. Matching on the date text as well as the id leaves a row alone if someone edited
 * it after it was read. It deliberately leaves `version` and `updated_at` alone: a backfill is
 * not somebody's edit, and bumping the version would make an open editor report a conflict for a
 * change it did not miss.
 */
export function backfillStatements(
	{ table, prefix: p }: DatedTable,
	rows: StoredDateRow[]
): string[] {
	return rows.flatMap((row) => {
		const c = dateColumnsFor(row.date_raw);
		const isCurrent =
			c.dateSort === row.date_sort &&
			c.dateSortEnd === row.date_sort_end &&
			c.dateQualifier === row.date_qualifier &&
			c.datePrecision === row.date_precision &&
			c.dateCalendar === row.date_calendar;
		if (isCurrent) return [];
		return [
			`UPDATE ${table} SET ${p}_sort = ${quote(c.dateSort)}, ${p}_sort_end = ${quote(c.dateSortEnd)}, ` +
				`${p}_qualifier = ${quote(c.dateQualifier)}, ${p}_precision = ${quote(c.datePrecision)}, ` +
				`${p}_calendar = ${quote(c.dateCalendar)} ` +
				`WHERE id = ${quote(row.id)} AND ${p}_raw = ${quote(row.date_raw)};`
		];
	});
}
