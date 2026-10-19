import { birthSortOf } from '../../shared/birth-order';
import { eventDateValue } from './date-columns';
import type { EventRow } from './change-log';

/** The events that date a birth when there is no birth fact: a christening or baptism. */
const BAPTISM_TYPES: ReadonlySet<string> = new Set(['CHR', 'BAPM']);

/**
 * The sort key of a person's birth from their own event rows, for ordering siblings. Reads the
 * stored bounds (parsing the text for a row from before they existed), so it can never disagree
 * with the date text shown beside it. Pass only the person's rows; masked rows give null.
 */
export function birthSortOfEvents(events: readonly EventRow[]): string | null {
	const dated = (isWanted: (type: string) => boolean) =>
		events.filter((e) => isWanted(e.type)).map(eventDateValue);
	return birthSortOf(
		dated((type) => type === 'BIRT'),
		dated((type) => BAPTISM_TYPES.has(type))
	);
}
