import { describe, expect, it } from 'vitest';
import {
	contrastRatio,
	formatHex,
	isHexColour,
	lightenHex,
	mixHex,
	oklabDistance,
	parseHex,
	relativeLuminance
} from './colour';

describe('hex', () => {
	it('accepts only six-digit hex, in either case', () => {
		expect(isHexColour('#A1b2C3')).toBe(true);
		expect(isHexColour('#abc')).toBe(false);
		expect(isHexColour('red')).toBe(false);
		expect(isHexColour('#12345g')).toBe(false);
	});

	it('parses and formats back to lower case', () => {
		const rgb = parseHex('#FF8000');
		expect(rgb).toEqual({ red: 255, green: 128, blue: 0 });
		expect(formatHex(rgb!)).toBe('#ff8000');
	});

	it('returns null for an invalid colour rather than guessing', () => {
		expect(parseHex('#zzzzzz')).toBeNull();
	});
});

describe('mixing', () => {
	it('mixes linearly and lightens toward white', () => {
		expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
		expect(lightenHex('#000000', 1)).toBe('#ffffff');
		expect(lightenHex('#336699', 0)).toBe('#336699');
	});

	it('refuses a malformed input instead of producing NaN', () => {
		expect(() => mixHex('nope', '#ffffff', 0.5)).toThrow(RangeError);
	});
});

describe('contrast', () => {
	it('gives 21 for black on white and 1 for a colour on itself', () => {
		expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
		expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
	});

	it('is symmetric in its arguments', () => {
		expect(contrastRatio('#1c1917', '#dbe8f5')).toBeCloseTo(
			contrastRatio('#dbe8f5', '#1c1917'),
			10
		);
	});

	it('matches the WCAG luminance of white', () => {
		expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
		expect(relativeLuminance('#000000')).toBe(0);
	});
});

describe('oklab distance', () => {
	it('is zero for the same colour and grows with difference', () => {
		expect(oklabDistance('#e69f00', '#e69f00')).toBe(0);
		const near = oklabDistance('#e69f00', '#e8a100');
		const far = oklabDistance('#e69f00', '#2f6fd0');
		expect(near).toBeLessThan(0.05);
		expect(far).toBeGreaterThan(near * 4);
	});
});
