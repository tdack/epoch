import { describe, expect, it } from 'vitest';
import { lifeGroupOf, lifeMap, type LifeFact } from './life-map';

const fact = (id: string, type: string, sortStart: string | null, place = 'P'): LifeFact => ({
	id,
	type,
	label: type,
	dateText: sortStart,
	sortStart,
	place
});
const cork = { latitude: 51.9, longitude: -8.47 };
const bath = { latitude: 51.38, longitude: -2.36 };

describe('lifeMap', () => {
	it('numbers dated facts in date order, whatever order they arrive in', () => {
		const m = lifeMap(
			[fact('d', 'DEAT', '1900'), fact('b', 'BIRT', '1832'), fact('r', 'RESI', '1860')],
			{ d: bath, b: cork, r: bath }
		);
		expect(m.items.map((i) => i.n)).toEqual([1, 2, 3]);
		expect(m.items[0]!.text).toContain('BIRT');
		expect(m.path).toEqual([
			[cork.latitude, cork.longitude],
			[bath.latitude, bath.longitude]
		]);
	});

	it('shares a marker between consecutive facts at one spot, with all its numbers', () => {
		const m = lifeMap(
			[fact('a', 'BIRT', '1832'), fact('b', 'CHR', '1832-02'), fact('c', 'RESI', '1850')],
			{ a: cork, b: cork, c: bath }
		);
		expect(m.stops.map((s) => s.numbers)).toEqual([[1, 2], [3]]);
		expect(m.stops[0]!.group).toBe('birth');
	});

	it('marks undated facts without joining them, and drops facts with no location', () => {
		const m = lifeMap(
			[fact('a', 'BIRT', '1832'), fact('u', 'OCCU', null), fact('n', 'DEAT', '1900')],
			{ a: cork, u: bath }
		);
		expect(m.path).toHaveLength(1);
		expect(m.stops).toHaveLength(2);
		expect(m.stops[1]).toMatchObject({ numbers: [], group: 'other' });
		expect(m.items.map((i) => i.n)).toEqual([1, null]);
	});

	it('groups types', () => {
		expect(['BAPM', 'MARR', 'CENS', 'BURI', 'EVEN'].map(lifeGroupOf)).toEqual([
			'birth',
			'partnership',
			'residence',
			'death',
			'other'
		]);
	});
});
