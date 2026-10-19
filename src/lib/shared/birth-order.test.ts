import { describe, expect, it } from 'vitest';
import { birthSortOf, sortByBirth, sortKeyOf } from './birth-order';
import { parseDateValue } from './date-value';

const keyOf = (text: string | null) => sortKeyOf(parseDateValue(text));

/** Children named by their date text, ordered with the comparator. */
function order(...dates: Array<string | null>): Array<string | null> {
	const kids = dates.map((text, i) => ({ text, name: `c${i}`, birthSort: keyOf(text) }));
	return sortByBirth(kids, (k) => k).map((k) => k.text);
}

describe('sortByBirth', () => {
	it('puts exact dates oldest first', () => {
		expect(order('3 MAR 1902', '1 JAN 1900', '5 JUN 1901')).toEqual([
			'1 JAN 1900',
			'5 JUN 1901',
			'3 MAR 1902'
		]);
	});

	it('puts a year-only date before exact dates in the same year, by its lower bound', () => {
		expect(order('15 MAR 1900', '1900', '2 JAN 1900')).toEqual([
			'1900',
			'2 JAN 1900',
			'15 MAR 1900'
		]);
	});

	it('orders ABT, BEF, AFT and ranges by their usable bound', () => {
		expect(order('AFT 1905', 'ABT 1900', 'BEF 1895', 'BET 1901 AND 1903')).toEqual([
			'BEF 1895',
			'ABT 1900',
			'BET 1901 AND 1903',
			'AFT 1905'
		]);
	});

	it('orders a dual date by its Gregorian (later) year', () => {
		expect(order('1702', '1700/01', '1700')).toEqual(['1700', '1700/01', '1702']);
	});

	it('puts undated children last, in the order they came', () => {
		expect(order(null, '1900', null, '1890', 'unreadable text')).toEqual([
			'1890',
			'1900',
			null,
			null,
			'unreadable text'
		]);
	});

	it('keeps equal dates as recorded unless an explicit order or the name says otherwise', () => {
		const kid = (name: string, order?: number) => ({ name, order, birthSort: '1900-01-01' });
		const names = (kids: ReturnType<typeof kid>[]) =>
			sortByBirth(kids, (k) => k).map((k) => k.name);
		expect(names([kid('Zed'), kid('Amy')])).toEqual(['Amy', 'Zed']);
		expect(names([kid('Zed', 1), kid('Amy', 2)])).toEqual(['Zed', 'Amy']);
		expect(names([kid('Amy'), kid('Amy')])).toEqual(['Amy', 'Amy']);
	});

	it('does not change its input', () => {
		const kids = [
			{ name: 'b', birthSort: '1901-01-01' },
			{ name: 'a', birthSort: '1900-01-01' }
		];
		sortByBirth(kids, (k) => k);
		expect(kids[0]!.name).toBe('b');
	});
});

describe('birthSortOf', () => {
	const date = (text: string) => parseDateValue(text);

	it('uses the birth, then its upper bound, then a baptism', () => {
		expect(birthSortOf([date('2 FEB 1900')], [date('1 MAR 1900')])).toBe('1900-02-02');
		expect(birthSortOf([date('BEF 1900')], [])).toBe(sortKeyOf(date('BEF 1900')));
		expect(birthSortOf([date('')], [date('1 MAR 1900')])).toBe('1900-03-01');
		expect(birthSortOf([], [])).toBeNull();
	});
});
