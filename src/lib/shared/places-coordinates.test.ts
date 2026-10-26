import { describe, expect, it } from 'vitest';
import { parseGedcomCoordinate } from './places-coordinates';

describe('parseGedcomCoordinate', () => {
	it('reads N, S, E and W as the sign of the axis they belong to', () => {
		expect(parseGedcomCoordinate('N18.150944', 'latitude')).toBe(18.150944);
		expect(parseGedcomCoordinate('S37.5622', 'latitude')).toBe(-37.5622);
		expect(parseGedcomCoordinate('E143.8503', 'longitude')).toBe(143.8503);
		expect(parseGedcomCoordinate('W0.1278', 'longitude')).toBe(-0.1278);
	});

	it('reads a bare signed decimal and ignores surrounding space and letter case', () => {
		expect(parseGedcomCoordinate('51.5', 'latitude')).toBe(51.5);
		expect(parseGedcomCoordinate('-0.1278', 'longitude')).toBe(-0.1278);
		expect(parseGedcomCoordinate('+12', 'latitude')).toBe(12);
		expect(parseGedcomCoordinate('  s37.5  ', 'latitude')).toBe(-37.5);
		expect(parseGedcomCoordinate('.5', 'latitude')).toBe(0.5);
		expect(parseGedcomCoordinate('5.', 'latitude')).toBe(5);
	});

	it('refuses text that is not a decimal', () => {
		for (const bad of [
			'',
			' ',
			'N',
			'abc',
			'N18.1.2',
			'1e3',
			'0x10',
			'Infinity',
			'N-5',
			'--5',
			'5 N'
		])
			expect(parseGedcomCoordinate(bad, 'latitude'), bad).toBeNull();
	});

	it('refuses a letter from the other axis rather than guessing', () => {
		expect(parseGedcomCoordinate('E10', 'latitude')).toBeNull();
		expect(parseGedcomCoordinate('N10', 'longitude')).toBeNull();
	});

	it('refuses out of range and keeps the limits themselves', () => {
		expect(parseGedcomCoordinate('N90', 'latitude')).toBe(90);
		expect(parseGedcomCoordinate('S90.0001', 'latitude')).toBeNull();
		expect(parseGedcomCoordinate('W180', 'longitude')).toBe(-180);
		expect(parseGedcomCoordinate('E180.5', 'longitude')).toBeNull();
		expect(parseGedcomCoordinate('-91', 'latitude')).toBeNull();
	});
});
