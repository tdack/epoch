import { describe, expect, it } from 'vitest';
import { ageAt, birthSpan } from './age';
import { parseDateValue } from './date-value';

const age = (birth: string, event: string) => ageAt(parseDateValue(birth), parseDateValue(event));

describe('ageAt', () => {
	it.each([
		['exact days, before the birthday', '15 MAR 1900', '14 MAR 1934', 'aged 33'],
		['exact days, on the birthday', '15 MAR 1900', '15 MAR 1934', 'aged 34'],
		['a leap-day birth in a common year', '29 FEB 1904', '28 FEB 1905', 'aged under 1'],
		['years only, which could fall either side', '1900', '1934', 'aged 33–34'],
		['a month and a year', 'MAR 1900', '20 APR 1934', 'aged 34'],
		['a range of births', 'BET 1850 AND 1860', '1900', 'aged 39–50'],
		['an approximate birth, read as its year', 'ABT 1900', '10 JUN 1950', 'aged 49–50'],
		['an infant death', '3 JAN 1900', '20 MAY 1900', 'aged under 1'],
		['a birth year and a death that year', '1900', '1900', 'aged under 1']
	])('%s', (_name, birth, event, expected) => {
		expect(age(birth, event)).toBe(expected);
	});

	it.each([
		['a birth open below', 'BEF 1900', '1950'],
		['an event open above', '1900', 'AFT 1950'],
		['an undated birth', '', '1950'],
		['an event before the birth', '1900', '1850']
	])('shows nothing for %s', (_name, birth, event) => {
		expect(age(birth, event)).toBeNull();
	});
});

describe('birthSpan', () => {
	const birth = (dateText: string | null) => ({
		type: 'BIRT',
		dateText,
		...parseDateValue(dateText)
	});

	it('widens across conflicting births, so neither is picked', () => {
		const span = birthSpan([birth('1900'), birth('1902'), { ...birth('1850'), type: 'CHR' }]);
		expect(span).toEqual({ sortStart: '1900-01-01', sortEnd: '1902-12-31' });
		expect(ageAt(span!, parseDateValue('1950'))).toBe('aged 47–50');
	});

	it('skips an undated birth, and is open when a dated one is', () => {
		expect(birthSpan([birth(null), birth('1900')])).toEqual({
			sortStart: '1900-01-01',
			sortEnd: '1900-12-31'
		});
		expect(birthSpan([birth('BEF 1900'), birth('1890')])!.sortStart).toBeNull();
		expect(birthSpan([birth(null)])).toBeNull();
	});
});
