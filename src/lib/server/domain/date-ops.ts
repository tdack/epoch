/**
 * Row operations for standardising dates: every date whose text has a standard GEDCOM spelling
 * that means the same date (`standardDateText`) is rewritten to it, on facts, names and citations.
 * A date Epoch cannot read, or one already standard, is never touched, so running it twice changes
 * nothing the second time.
 */

import type { CitationRow, EventRow, PersonNameRow, RowOp, TreeRows } from './change-log';
import { dateColumnsFor } from './date-columns';
import { standardDateText } from '../../shared/date-value';
import { MAX_DATE_REWRITES } from '../../shared/date-tidy';

export type DateCommand = { kind: 'standardise_dates' };

/** One date that would be rewritten, with the row it is on. */
export type DateRewrite =
	| { table: 'events'; row: EventRow; before: string; after: string }
	| { table: 'person_names'; row: PersonNameRow; before: string; after: string }
	| { table: 'citations'; row: CitationRow; before: string; after: string };

interface DateContext {
	/** Epoch milliseconds, stamped on every row written. */
	now: number;
}

/** Vitals are on the person form too, so changing one must make a stale form conflict (as `update_fact` does). */
const VITAL_TYPES = new Set(['BIRT', 'DEAT']);

/** Every date in the tree with a standard form to take, in the order the tree stores them. */
export function dateRewrites(rows: TreeRows): DateRewrite[] {
	const found: DateRewrite[] = [];
	for (const row of rows.events) {
		const after = standardDateText(row.dateRaw);
		if (after) found.push({ table: 'events', row, before: row.dateRaw!.trim(), after });
	}
	for (const row of rows.personNames) {
		const after = standardDateText(row.dateRaw);
		if (after) found.push({ table: 'person_names', row, before: row.dateRaw!.trim(), after });
	}
	for (const row of rows.citations) {
		const after = standardDateText(row.entryDateRaw);
		if (after) found.push({ table: 'citations', row, before: row.entryDateRaw!.trim(), after });
	}
	return found;
}

/**
 * The first `MAX_DATE_REWRITES` rewrites. A tree with more is done in turns rather than refused:
 * each turn is one change and one undo, and the next turn finds what is left.
 */
export function buildDateOps(rows: TreeRows, _command: DateCommand, ctx: DateContext): RowOp[] {
	const ops: RowOp[] = [];
	const bumped = new Set<string>();
	const bumpPerson = (personId: string) => {
		const person = rows.individuals.find((p) => p.id === personId);
		if (!person || bumped.has(person.id)) return;
		bumped.add(person.id);
		ops.push({
			table: 'individuals',
			id: person.id,
			before: person,
			after: { ...person, version: person.version + 1, updatedAt: ctx.now }
		});
	};
	for (const rewrite of dateRewrites(rows).slice(0, MAX_DATE_REWRITES)) {
		const columns = dateColumnsFor(rewrite.after);
		if (rewrite.table === 'events') {
			const fact = rewrite.row;
			ops.push({
				table: 'events',
				id: fact.id,
				before: fact,
				after: {
					...fact,
					dateRaw: rewrite.after,
					...columns,
					version: fact.version + 1,
					updatedAt: ctx.now
				}
			});
			if (fact.entityType === 'INDIVIDUAL' && VITAL_TYPES.has(fact.type)) bumpPerson(fact.entityId);
		} else if (rewrite.table === 'person_names') {
			const name = rewrite.row;
			ops.push({
				table: 'person_names',
				id: name.id,
				before: name,
				after: { ...name, dateRaw: rewrite.after, ...columns }
			});
			// A name has no version of its own; the person's makes an open name form conflict.
			bumpPerson(name.personId);
		} else {
			const citation = rewrite.row;
			ops.push({
				table: 'citations',
				id: citation.id,
				before: citation,
				after: {
					...citation,
					entryDateRaw: rewrite.after,
					entryDateSort: columns.dateSort,
					entryDateSortEnd: columns.dateSortEnd,
					entryDateQualifier: columns.dateQualifier,
					entryDatePrecision: columns.datePrecision,
					entryDateCalendar: columns.dateCalendar,
					version: citation.version + 1,
					updatedAt: ctx.now
				}
			});
		}
	}
	return ops;
}
