import { dateColumnsFor } from './date-columns';

export interface UnbackfilledEvent {
	id: string;
	date_raw: string;
}

/** Rows `scripts/backfill-event-dates.mjs` has to fill in: dated, with no structured columns yet. */
export const UNBACKFILLED_EVENTS_SQL =
	'SELECT id, date_raw FROM events WHERE date_raw IS NOT NULL AND date_qualifier IS NULL';

const quote = (value: string | null) =>
	value === null ? 'NULL' : `'${value.replaceAll("'", "''")}'`;

/**
 * One UPDATE per event, from `date_raw` alone. It deliberately leaves `version` and `updated_at`
 * alone: a backfill is not somebody's edit, and bumping the version would make an open editor
 * report a conflict for a change it did not miss.
 */
export function backfillStatements(events: UnbackfilledEvent[]): string[] {
	return events.map((event) => {
		const c = dateColumnsFor(event.date_raw);
		return (
			`UPDATE events SET date_sort = ${quote(c.dateSort)}, date_sort_end = ${quote(c.dateSortEnd)}, ` +
			`date_qualifier = ${quote(c.dateQualifier)}, date_precision = ${quote(c.datePrecision)}, ` +
			`date_calendar = ${quote(c.dateCalendar)} WHERE id = ${quote(event.id)} AND date_qualifier IS NULL;`
		);
	});
}
