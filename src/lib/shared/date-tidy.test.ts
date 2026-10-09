import { describe, expect, it } from 'vitest';
import { tidyDateText } from './date-tidy';
import { parseDateValue, standardDateText } from './date-value';

describe('tidyDateText', () => {
	it.each([
		['3 RD DECEMBER 1996', '3 DEC 1996'],
		['3rd December 1996', '3 DEC 1996'],
		['29 JANUAY 1959', '29 JAN 1959'],
		['2 FEBUARY 1900', '2 FEB 1900'],
		['14 August 1975', '14 AUG 1975'],
		['5 SEPT 1900', '5 SEP 1900'],
		['CIRCA 1937', 'ABT 1937'],
		['c. 1937', 'ABT 1937'],
		['ca 1937', 'ABT 1937'],
		['bet 1900 and 1910', 'BET 1900 AND 1910'],
		['Before  12 March 1850', 'BEF 12 MAR 1850'],
		['INT 3rd Dec 1996 (as Dec. 3rd)', 'INT 3 DEC 1996 (as Dec. 3rd)'],
		['(sometime in the war)', '(sometime in the war)']
	])('spells %s as %s', (raw, tidy) => {
		expect(tidyDateText(raw)).toBe(tidy);
	});

	it('leaves alone a word that only looks like a month, and a bare letter', () => {
		expect(tidyDateText('MAYBE 1900')).toBe('MAYBE 1900');
		expect(tidyDateText('C 1900')).toBe('C 1900');
		expect(tidyDateText('JUNK 1900')).toBe('JUNK 1900');
		expect(tidyDateText('JULES 1900')).toBe('JULES 1900');
	});
});

describe('parseDateValue, reading loosely typed dates', () => {
	it('reads them through their standard spelling and keeps the text as written', () => {
		const value = parseDateValue('3 RD DECEMBER 1996');
		expect(value).toMatchObject({ raw: '3 RD DECEMBER 1996', sortStart: '1996-12-03' });
		expect(parseDateValue('CIRCA 1937')).toMatchObject({ qualifier: 'ABOUT' });
		expect(parseDateValue('29 JANUAY 1959').sortStart).toBe('1959-01-29');
	});

	it('still cannot read what has no single meaning', () => {
		for (const raw of ['30 FEB 1946', '01 MAR 191503 08 1912', '193518 JUN 1934', 'MAYBE 1900'])
			expect(parseDateValue(raw).qualifier).toBe('UNKNOWN');
	});
});

describe('standardDateText', () => {
	it('offers the standard spelling only when it differs and means the same', () => {
		expect(standardDateText('3 RD DECEMBER 1996')).toBe('3 DEC 1996');
		expect(standardDateText('14 August 1975')).toBe('14 AUG 1975');
		expect(standardDateText('14 AUG 1975')).toBeNull();
		expect(standardDateText('ABT 1900')).toBeNull();
		expect(standardDateText('(during the war)')).toBeNull();
	});

	it('offers nothing for a date it cannot read', () => {
		for (const raw of ['30 FEB 1946', '01 MAR 191503 08 1912', '193518 JUN 1934', 'MAYBE 1900', ''])
			expect(standardDateText(raw)).toBeNull();
	});

	it('gives text that needs no further tidying', () => {
		const once = standardDateText('3 RD DECEMBER 1996')!;
		expect(standardDateText(once)).toBeNull();
	});
});
