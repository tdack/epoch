import { describe, expect, it } from 'vitest';
import { DATE_FORMATS, displayDate, isDateFormat } from './date-display';

describe('displayDate in the default day-month-year format', () => {
	it.each([
		['an exact day', '3 MAR 1900', '3 March 1900'],
		['a month and year', 'MAR 1900', 'March 1900'],
		['a year', '1900', '1900'],
		['a three-digit year', '950', '950'],
		['about', 'ABT 1900', 'about 1900'],
		['estimated', 'EST 1900', 'estimated 1900'],
		['calculated', 'CAL 3 MAR 1900', 'calculated 3 March 1900'],
		['before', 'BEF 1900', 'before 1900'],
		['after', 'AFT MAR 1900', 'after March 1900'],
		['between', 'BET 1968 AND 1970', 'between 1968 and 1970'],
		['between mixed precisions', 'BET MAR 1900 AND 1905', 'between March 1900 and 1905'],
		['a period', 'FROM 1900 TO 1910', 'from 1900 to 1910'],
		['an open period from', 'FROM 1900', 'from 1900'],
		['an open period to', 'TO 1910', 'until 1910'],
		['a dual year', '30 JAN 1648/49', '30 January 1648/49'],
		['a dual year in a range', 'BET 1648/49 AND 1650', 'between 1648/49 and 1650'],
		['an interpreted date keeps its words', 'INT 1900 (from the Census)', '1900 (from the Census)'],
		[
			'a phrase loses only its brackets',
			'(about the time of the Great War)',
			'about the time of the Great War'
		],
		['lower case', 'abt 1900', 'about 1900'],
		['a loosely typed date', 'circa 1937', 'about 1937'],
		['full month names', '14 August 1975', '14 August 1975'],
		['an ordinal day', '3 RD DECEMBER 1996', '3 December 1996'],
		['an impossible day stays as written', '31 FEB 1900', '31 FEB 1900'],
		['a calendar escape stays as written', '@#DJULIAN@ 1 JAN 1700', '@#DJULIAN@ 1 JAN 1700'],
		['junk stays as written', 'sometime in spring', 'sometime in spring'],
		['a range with an unreadable end stays as written', 'BET 1900 AND later', 'BET 1900 AND later'],
		['BET with TO stays as written', 'BET 1900 TO 1910', 'BET 1900 TO 1910'],
		['surrounding space', '  1900 ', '1900']
	])('%s: %s → %s', (_, raw, expected) => {
		expect(displayDate(raw)).toBe(expected);
	});

	it.each([null, undefined, '', '   '])('is empty for %j', (raw) => {
		expect(displayDate(raw)).toBe('');
	});
});

describe('displayDate in the other formats', () => {
	it.each([
		[DATE_FORMATS.MONTH_DAY_YEAR, '3 MAR 1900', 'March 3, 1900'],
		[DATE_FORMATS.MONTH_DAY_YEAR, 'MAR 1900', 'March 1900'],
		[DATE_FORMATS.MONTH_DAY_YEAR, 'BET 3 MAR 1900 AND 1905', 'between March 3, 1900 and 1905'],
		[DATE_FORMATS.SHORT, '3 MAR 1900', '03 Mar 1900'],
		[DATE_FORMATS.SHORT, 'SEP 1900', 'Sep 1900'],
		[DATE_FORMATS.SHORT, 'ABT 1900', 'about 1900'],
		[DATE_FORMATS.NUMERIC, '3 MAR 1900', '03/03/1900'],
		[DATE_FORMATS.NUMERIC, 'MAR 1900', '03/1900'],
		[DATE_FORMATS.NUMERIC, '1900', '1900'],
		[DATE_FORMATS.NUMERIC, '30 JAN 1648/49', '01/30/1648/49']
	])('%s: %s → %s', (format, raw, expected) => {
		expect(displayDate(raw, format)).toBe(expected);
	});
});

describe('isDateFormat', () => {
	it('accepts each format and nothing else', () => {
		for (const format of Object.values(DATE_FORMATS)) expect(isDateFormat(format)).toBe(true);
		expect(isDateFormat('iso')).toBe(false);
		expect(isDateFormat(null)).toBe(false);
	});
});
