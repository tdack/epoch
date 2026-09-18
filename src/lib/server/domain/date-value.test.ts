import { describe, it, expect } from 'vitest';
import { parseDateValue, DATE_QUALIFIERS, DATE_PRECISIONS } from './date-value';

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

	it('handles dual Julian/Gregorian dates', () => {
		const v = parseDateValue('15 JAN 1900/01');
		expect(v.calendar).toBe('JULIAN');
		expect(v.sortStart).toBe('1900-01-15');
	});
});