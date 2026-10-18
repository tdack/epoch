import { describe, it, expect } from 'vitest';
import {
	parseDateValue,
	checkDateText,
	DATE_EXAMPLES,
	pickerStateOf,
	formatPickerDate,
	DATE_QUALIFIERS,
	DATE_PRECISIONS
} from './date-value';

describe('parseDateValue', () => {
	it('parses an exact day', () => {
		const v = parseDateValue('15 JAN 1900');
		expect(v.qualifier).toBe(DATE_QUALIFIERS.EXACT);
		expect(v.precision).toBe(DATE_PRECISIONS.DAY);
		expect(v.sortStart).toBe('1900-01-15');
		expect(v.sortEnd).toBe('1900-01-15');
		expect(v.isApproximate).toBe(false);
	});

	it('preserves month precision without fabricating a day', () => {
		const v = parseDateValue('MAY 1920');
		expect(v.precision).toBe(DATE_PRECISIONS.MONTH);
		expect(v.sortStart).toBe('1920-05-01');
		expect(v.sortEnd).toBe('1920-05-31');
	});

	it('preserves year precision without fabricating a day', () => {
		const v = parseDateValue('1900');
		expect(v.precision).toBe(DATE_PRECISIONS.YEAR);
		expect(v.sortStart).toBe('1900-01-01');
		expect(v.sortEnd).toBe('1900-12-31');
	});

	it('keeps approximate qualifiers rather than collapsing to exact', () => {
		const v = parseDateValue('ABT 1900');
		expect(v.qualifier).toBe(DATE_QUALIFIERS.ABOUT);
		expect(v.precision).toBe(DATE_PRECISIONS.YEAR);
		expect(v.isApproximate).toBe(true);
		expect(v.sortStart).toBe('1900-01-01');
		expect(v.sortEnd).toBe('1900-12-31');
	});

	it('parses estimated and calculated qualifiers', () => {
		expect(parseDateValue('EST 1850').qualifier).toBe(DATE_QUALIFIERS.ESTIMATED);
		expect(parseDateValue('CAL 1900').qualifier).toBe(DATE_QUALIFIERS.CALCULATED);
	});

	it('parses before/after as exclusive bounds', () => {
		const before = parseDateValue('BEF 1900');
		expect(before.qualifier).toBe(DATE_QUALIFIERS.BEFORE);
		expect(before.sortStart).toBeNull();
		expect(before.sortEnd).toBe('1899-12-31');

		const after = parseDateValue('AFT 1900');
		expect(after.qualifier).toBe(DATE_QUALIFIERS.AFTER);
		expect(after.sortStart).toBe('1901-01-01');
		expect(after.sortEnd).toBeNull();
	});

	it('parses between ranges', () => {
		const v = parseDateValue('BET 1860 AND 1865');
		expect(v.qualifier).toBe(DATE_QUALIFIERS.BETWEEN);
		expect(v.sortStart).toBe('1860-01-01');
		expect(v.sortEnd).toBe('1865-12-31');
	});

	it('parses from/to ranges', () => {
		const v = parseDateValue('FROM 1901 TO 1905');
		expect(v.qualifier).toBe(DATE_QUALIFIERS.FROM_TO);
		expect(v.sortStart).toBe('1901-01-01');
		expect(v.sortEnd).toBe('1905-12-31');
	});

	it('gives FROM x a start and no end', () => {
		const v = parseDateValue('FROM 1980');
		expect(v.qualifier).toBe(DATE_QUALIFIERS.FROM_TO);
		expect(v.precision).toBe(DATE_PRECISIONS.YEAR);
		expect(v.sortStart).toBe('1980-01-01');
		expect(v.sortEnd).toBeNull();
		expect(parseDateValue('FROM MAR 1980').sortStart).toBe('1980-03-01');
	});

	it('gives TO y an end and no start', () => {
		const v = parseDateValue('TO 1985');
		expect(v.qualifier).toBe(DATE_QUALIFIERS.FROM_TO);
		expect(v.sortStart).toBeNull();
		expect(v.sortEnd).toBe('1985-12-31');
	});

	it('leaves an unreadable open period unknown', () => {
		expect(parseDateValue('FROM sometime').qualifier).toBe(DATE_QUALIFIERS.UNKNOWN);
	});

	it('treats phrase dates as unsortable', () => {
		const v = parseDateValue('(about 1900)');
		expect(v.qualifier).toBe(DATE_QUALIFIERS.PHRASE);
		expect(v.sortStart).toBeNull();
		expect(v.sortEnd).toBeNull();
	});

	it('handles empty and unknown input', () => {
		expect(parseDateValue('').qualifier).toBe(DATE_QUALIFIERS.UNKNOWN);
		expect(parseDateValue(null).precision).toBe(DATE_PRECISIONS.NONE);
		expect(parseDateValue('gibberish').qualifier).toBe(DATE_QUALIFIERS.UNKNOWN);
	});

	it('sorts a dual date on its later (Gregorian) year', () => {
		const v = parseDateValue('30 JAN 1648/49');
		expect(v.calendar).toBe('JULIAN');
		expect(v.qualifier).toBe(DATE_QUALIFIERS.EXACT);
		expect(v.sortStart).toBe('1649-01-30');
		expect(v.sortEnd).toBe('1649-01-30');
		expect(v.raw).toBe('30 JAN 1648/49');
	});

	it.each([
		['15 JAN 1900/01', '1901-01-15', '1901-01-15'],
		['FEB 1648/49', '1649-02-01', '1649-02-28'],
		['1648/9', '1649-01-01', '1649-12-31'],
		['1699/00', '1700-01-01', '1700-12-31'],
		['MAR 1709/0', '1710-03-01', '1710-03-31'],
		['ABT 1648/49', '1649-01-01', '1649-12-31'],
		['BET 1640 AND 1648/49', '1640-01-01', '1649-12-31']
	])('dual date %s sorts from %s to %s', (raw, start, end) => {
		const v = parseDateValue(raw);
		expect(v.calendar).toBe('JULIAN');
		expect([v.sortStart, v.sortEnd]).toEqual([start, end]);
	});

	it('bounds BEF and AFT dual dates by the later year', () => {
		expect(parseDateValue('BEF 1 FEB 1648/49').sortEnd).toBe('1649-01-31');
		expect(parseDateValue('AFT 1 FEB 1648/49').sortStart).toBe('1649-02-02');
	});

	it('checks a dual date day against its later year', () => {
		expect(parseDateValue('29 FEB 1647/48').sortStart).toBe('1648-02-29');
		expect(checkDateText('29 FEB 1647/48').isValid).toBe(true);
		expect(checkDateText('29 FEB 1648/49').isValid).toBe(false);
	});
});
describe('checkDateText', () => {
	it.each(DATE_EXAMPLES.map((example) => example.text))('accepts the help example %s', (text) => {
		expect(checkDateText(text)).toEqual({ isValid: true });
	});

	it.each([
		'',
		'  ',
		'1912',
		'APR 1912',
		'14 apr 1912',
		'ABT 1900',
		'BET 1900 AND 1905',
		'(about the war)',
		'29 FEB 1904'
	])('accepts %j', (text) => expect(checkDateText(text).isValid).toBe(true));

	it.each(['31 FEB 1900', '29 FEB 1900', 'banana', '14 APR', 'BET 1905 AND 1900', '32 JAN 1900'])(
		'refuses %j',
		(text) => expect(checkDateText(text).isValid).toBe(false)
	);

	it('explains that a two-digit year is ambiguous', () => {
		expect(checkDateText('1 JAN 26').message).toMatch(/full year/);
	});
});

describe('picker helpers', () => {
	it('keeps a qualifier and reads the date under it', () => {
		expect(pickerStateOf('abt 3 mar 1901')).toEqual({
			date: { year: 1901, month: 3, day: 3 },
			prefix: 'ABT '
		});
	});

	it('starts empty for ranges and unreadable text', () => {
		expect(pickerStateOf('BET 1900 AND 1905').date).toBeNull();
		expect(pickerStateOf('banana').date).toBeNull();
	});

	it('writes each precision the way the app stores it', () => {
		expect(formatPickerDate({ year: 1912, month: 4, day: 14 })).toBe('14 APR 1912');
		expect(formatPickerDate({ year: 1912, month: 4, day: null })).toBe('APR 1912');
		expect(formatPickerDate({ year: 1912, month: null, day: null })).toBe('1912');
	});
});
