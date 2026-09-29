import { describe, expect, it } from 'vitest';
import { dateColumnsFor, eventDateValue } from './date-columns';

describe('dateColumnsFor', () => {
	it('keeps a year a year: bounds span the year and no day is invented', () => {
		expect(dateColumnsFor('1900')).toEqual({
			dateSort: '1900-01-01',
			dateSortEnd: '1900-12-31',
			dateQualifier: 'EXACT',
			datePrecision: 'YEAR',
			dateCalendar: 'GREGORIAN'
		});
	});

	it('keeps ABT 1900 approximate, at year precision', () => {
		expect(dateColumnsFor('ABT 1900')).toMatchObject({
			dateSort: '1900-01-01',
			dateSortEnd: '1900-12-31',
			dateQualifier: 'ABOUT',
			datePrecision: 'YEAR'
		});
	});

	it('keeps a month a month and a full date a day', () => {
		expect(dateColumnsFor('MAY 1920')).toMatchObject({ dateSort: '1920-05-01', dateSortEnd: '1920-05-31', datePrecision: 'MONTH' });
		expect(dateColumnsFor('3 Nov 2014')).toMatchObject({ dateSort: '2014-11-03', dateSortEnd: '2014-11-03', datePrecision: 'DAY' });
	});

	it('leaves the open end of BEF and AFT open, and keeps a range as a range', () => {
		expect(dateColumnsFor('BEF 1900')).toMatchObject({ dateSort: null, dateSortEnd: '1899-12-31', dateQualifier: 'BEFORE' });
		expect(dateColumnsFor('AFT 1900')).toMatchObject({ dateSort: '1901-01-01', dateSortEnd: null, dateQualifier: 'AFTER' });
		expect(dateColumnsFor('BET 1860 AND 1865')).toMatchObject({ dateSort: '1860-01-01', dateSortEnd: '1865-12-31', dateQualifier: 'BETWEEN' });
	});

	it('marks text that is not a date, so it differs from a row nobody has parsed', () => {
		expect(dateColumnsFor('(about the time of the flood)')).toMatchObject({ dateQualifier: 'PHRASE', dateSort: null });
		expect(dateColumnsFor('sometime')).toMatchObject({ dateQualifier: 'UNKNOWN', datePrecision: 'NONE', dateSort: null });
	});

	it('is all null for no date', () => {
		for (const text of [null, undefined, '', '   ']) {
			expect(Object.values(dateColumnsFor(text))).toEqual([null, null, null, null, null]);
		}
	});
});

describe('eventDateValue', () => {
	it('reads the stored columns', () => {
		const value = eventDateValue({ dateRaw: 'ABT 1900', ...dateColumnsFor('ABT 1900') });
		expect(value).toMatchObject({ qualifier: 'ABOUT', precision: 'YEAR', sortStart: '1900-01-01', sortEnd: '1900-12-31', isApproximate: true });
	});

	it('parses date_raw for a row from before the columns existed', () => {
		const old = { dateRaw: '1900', dateSort: '1900-01-01', dateSortEnd: null, dateQualifier: null, datePrecision: null, dateCalendar: null };
		expect(eventDateValue(old)).toMatchObject({ qualifier: 'EXACT', precision: 'YEAR', sortEnd: '1900-12-31' });
	});
});
