import { describe, expect, it } from 'vitest';
import { ValidationError } from './errors';
import { applyPatch, assertContrastFloors, type SettingsDocument } from './settings';

const SEX = { male: '#5a84b5', female: '#b8607f', unknown: '#7d756a' };

describe('applyPatch', () => {
	it('replaces a present group, leaves an absent one, and clears a null one', () => {
		const current: SettingsDocument = { sexColours: SEX, isMotionReduced: true };
		const next = applyPatch(current, {
			sexColours: { ...SEX, male: '#111111' },
			isMotionReduced: null
		});
		expect(next.sexColours?.male).toBe('#111111');
		expect(next).not.toHaveProperty('isMotionReduced');
		expect(applyPatch(current, {})).toEqual(current);
	});
});

describe('assertContrastFloors', () => {
	it('accepts the built-in sex colours', () => {
		expect(() => assertContrastFloors({ sexColours: SEX })).not.toThrow();
	});

	it('refuses a card border too close to its fill, naming the sex', () => {
		expect(() => assertContrastFloors({ sexColours: { ...SEX, male: '#ffff00' } })).toThrow(
			ValidationError
		);
		expect(() => assertContrastFloors({ sexColours: { ...SEX, male: '#ffff00' } })).toThrow(/Male/);
	});

	it('refuses a sphere too dark to see on the dark stage', () => {
		expect(() => assertContrastFloors({ sexColours: { ...SEX, female: '#101525' } })).toThrow(
			/sphere/
		);
	});

	it('passes when no sex colour is set', () => {
		expect(() => assertContrastFloors({ isMotionReduced: true })).not.toThrow();
	});
});
