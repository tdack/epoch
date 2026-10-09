import { describe, expect, it } from 'vitest';
import { parseDateValue } from '../../shared/date-value';
import { fromGedcom7Date, toGedcom551Date, toGedcom7Date } from './date-dialect';

describe('toGedcom7Date', () => {
	it.each([
		['1900', '1900'],
		['ABT 1900', 'ABT 1900'],
		['bet 1 jan 1900 and 1910', 'BET 1 JAN 1900 AND 1910'],
		['FROM 1900 TO 1910', 'FROM 1900 TO 1910'],
		['TO 1910', 'TO 1910'],
		['@#DJULIAN@ 1 JAN 1700', 'JULIAN 1 JAN 1700'],
		['@#DFRENCH R@ 1 VEND 10', 'FRENCH_R 1 VEND 10'],
		['@#DHEBREW@ TSH 5700', 'HEBREW TSH 5700'],
		['44 B.C.', '44 BCE'],
		['ABOUT 12 March 1850', 'ABT 12 MAR 1850'],
		['circa 1937', 'ABT 1937'],
		['3 RD DECEMBER 1996', '3 DEC 1996'],
		['29 JANUAY 1959', '29 JAN 1959'],
		['JULIAN 1 JAN 1700', 'JULIAN 1 JAN 1700']
	])('writes %s as %s', (stored, value) => {
		expect(toGedcom7Date(stored)).toEqual({ value });
	});

	it('writes a dual year as its later year, with the original as the phrase', () => {
		expect(toGedcom7Date('30 JAN 1648/49')).toEqual({
			value: '30 JAN 1649',
			phrase: '30 JAN 1648/49'
		});
		expect(toGedcom7Date('1699/00')).toEqual({ value: '1700', phrase: '1699/00' });
	});

	it('splits an interpreted date and a phrase-only date into DATE and PHRASE', () => {
		expect(toGedcom7Date('INT 1900 (about the turn of the century)')).toEqual({
			value: '1900',
			phrase: 'about the turn of the century'
		});
		expect(toGedcom7Date('(during the war)')).toEqual({ value: '', phrase: 'during the war' });
	});

	it('keeps text that is no 7.0 date as the phrase of an empty DATE', () => {
		expect(toGedcom7Date('Spring 1900')).toEqual({ value: '', phrase: 'Spring 1900' });
		expect(toGedcom7Date('@#DROMAN@ 1900')).toEqual({ value: '', phrase: '@#DROMAN@ 1900' });
		expect(toGedcom7Date('32 FOO 1900')).toEqual({ value: '', phrase: '32 FOO 1900' });
	});
});

describe('fromGedcom7Date', () => {
	it('stores a dated phrase as INT, and a phrase alone in parentheses', () => {
		expect(fromGedcom7Date('1900', undefined)).toBe('1900');
		expect(fromGedcom7Date('30 JAN 1649', '30 JAN 1648/49')).toBe(
			'INT 30 JAN 1649 (30 JAN 1648/49)'
		);
		expect(fromGedcom7Date('', 'during the war')).toBe('(during the war)');
	});

	it('comes back to the same 7.0 date, and still sorts', () => {
		const stored = fromGedcom7Date('30 JAN 1649', '30 JAN 1648/49');
		expect(toGedcom7Date(stored)).toEqual({ value: '30 JAN 1649', phrase: '30 JAN 1648/49' });
		expect(parseDateValue(stored).sortStart).toBe('1649-01-30');
	});
});

describe('toGedcom551Date', () => {
	it('writes a 7.0 calendar and epoch the 5.5.1 way', () => {
		expect(toGedcom551Date('JULIAN 1 JAN 1700')).toBe('@#DJULIAN@ 1 JAN 1700');
		expect(toGedcom551Date('BET FRENCH_R 1 VEND 10 AND 1 BRUM 10')).toBe(
			'BET @#DFRENCH R@ 1 VEND 10 AND 1 BRUM 10'
		);
		expect(toGedcom551Date('44 BCE')).toBe('44 B.C.');
		expect(toGedcom551Date('ABT 1900')).toBe('ABT 1900');
	});
});
