import { describe, expect, it } from 'vitest';
import { chartDates } from './charts';
import { lifeDates } from './life-dates';

describe('lifeDates', () => {
	it('shows stored GEDCOM as words in the default format', () => {
		expect(lifeDates('ABT 1850', '3 MAR 1920', true)).toBe('about 1850 – 3 March 1920');
		expect(lifeDates('3 MAR 1900', null, false)).toBe('b. 3 March 1900');
		expect(lifeDates(null, null, true)).toBe('deceased');
	});

	it('honours the tree’s format', () => {
		expect(lifeDates('3 MAR 1900', '1 JAN 1950', true, 'month_day_year')).toBe(
			'March 3, 1900 – January 1, 1950'
		);
		expect(lifeDates(null, '1 JAN 1950', true, 'numeric')).toBe('d. 01/01/1950');
	});
});

describe('chartDates', () => {
	it('uses the tree’s format and marks an unknown birth', () => {
		expect(chartDates('3 MAR 1900', null, 'short')).toBe('03 Mar 1900 –');
		expect(chartDates(null, '1950', 'short')).toBe('? – 1950');
		expect(chartDates(null, null)).toBe('');
	});
});
