import { describe, expect, it } from 'vitest';
import {
	backfillStatements,
	DATED_TABLES,
	staleDatesSql,
	type StoredDateRow
} from './date-backfill';

const events = DATED_TABLES[0];
const citations = DATED_TABLES[2];

const row = (overrides: Partial<StoredDateRow>): StoredDateRow => ({
	id: 'e1',
	date_raw: '30 JAN 1648/49',
	date_sort: null,
	date_sort_end: null,
	date_qualifier: null,
	date_precision: null,
	date_calendar: null,
	...overrides
});

describe('date backfill', () => {
	it('selects unfilled rows, unreadable ones and dual dates under the table column prefix', () => {
		const sql = staleDatesSql(citations);
		expect(sql).toContain('entry_date_raw AS date_raw');
		expect(sql).toContain('FROM citations');
		expect(sql).toContain(
			"entry_date_qualifier IS NULL OR entry_date_qualifier = 'UNKNOWN' OR entry_date_calendar = 'JULIAN'"
		);
	});

	it('fills a row that has no structured columns', () => {
		const [statement] = backfillStatements(events, [row({ date_raw: 'ABT 1900' })]);
		expect(statement).toBe(
			"UPDATE events SET date_sort = '1900-01-01', date_sort_end = '1900-12-31', " +
				"date_qualifier = 'ABOUT', date_precision = 'YEAR', date_calendar = 'GREGORIAN' " +
				"WHERE id = 'e1' AND date_raw = 'ABT 1900';"
		);
	});

	it('moves a dual date stored on its earlier year to the later one', () => {
		const stale = row({
			date_sort: '1648-01-30',
			date_sort_end: '1648-01-30',
			date_qualifier: 'EXACT',
			date_precision: 'DAY',
			date_calendar: 'JULIAN'
		});
		const [statement] = backfillStatements(citations, [stale]);
		expect(statement).toContain("entry_date_sort = '1649-01-30'");
		expect(statement).toContain("entry_date_sort_end = '1649-01-30'");
		expect(statement).toContain("WHERE id = 'e1' AND entry_date_raw = '30 JAN 1648/49';");
	});

	it('reads a date stored as unreadable that the reader now understands, and leaves one it does not', () => {
		const unknown = {
			date_qualifier: 'UNKNOWN',
			date_precision: 'NONE',
			date_calendar: 'GREGORIAN'
		};
		const [statement] = backfillStatements(events, [
			row({ date_raw: '3 RD DECEMBER 1996', ...unknown })
		]);
		expect(statement).toContain("date_sort = '1996-12-03'");
		expect(statement).toContain("date_raw = '3 RD DECEMBER 1996'");
		const stillUnreadable = backfillStatements(events, [
			row({ date_raw: '01 MAR 191503 08 1912', ...unknown })
		]);
		expect(stillUnreadable).toEqual([]);
	});

	it('writes nothing for a row that is already current', () => {
		const current = row({
			date_sort: '1649-01-30',
			date_sort_end: '1649-01-30',
			date_qualifier: 'EXACT',
			date_precision: 'DAY',
			date_calendar: 'JULIAN'
		});
		expect(backfillStatements(events, [current])).toEqual([]);
	});

	it('quotes the date text it matches on', () => {
		const [statement] = backfillStatements(events, [row({ date_raw: "(the Smiths' wedding)" })]);
		expect(statement).toContain("date_raw = '(the Smiths'' wedding)';");
	});
});
