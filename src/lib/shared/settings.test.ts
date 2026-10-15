import { describe, expect, it } from 'vitest';
import { DEFAULT_PALETTE, resolvePalette } from '#lib/components/tree/palette.js';
import { COLOUR_PRESETS, floorBreaches, paletteWarnings, sexContrast } from './settings';

describe('contrast floors', () => {
	it('passes the built-in palette', () => {
		expect(floorBreaches(DEFAULT_PALETTE)).toEqual([]);
	});

	it('names the sex and the floor a pale border breaks', () => {
		const palette = resolvePalette({
			sexColours: { male: '#ffff00', female: '#b8607f', unknown: '#7d756a' }
		});
		const [breach] = floorBreaches(palette);
		expect(breach).toMatchObject({ sex: 'male', check: 'border' });
		expect(breach.message).toMatch(/^Male: /);
	});

	it('reports the worst stage for the sphere', () => {
		const ratios = sexContrast(DEFAULT_PALETTE, 'unknown');
		expect(ratios.sphere).toBeGreaterThanOrEqual(3);
		expect(ratios.ink).toBeGreaterThan(ratios.border);
	});
});

describe('soft warnings', () => {
	it('raises none for the built-in palette', () => {
		expect(paletteWarnings(DEFAULT_PALETTE)).toEqual([]);
	});

	it('warns when two trace colours look alike, and when one looks like a sex colour', () => {
		const palette = resolvePalette({
			tracePalette: {
				trace: ['#e69f00', '#e69f02', '#d55e00', '#f0e442', '#7b5fd1', '#5a84b6'],
				intersection: '#c026d3'
			}
		});
		const warnings = paletteWarnings(palette);
		expect(warnings).toContain('Trace colours 1 and 2 are hard to tell apart.');
		expect(warnings).toContain('Trace colour 6 looks like the male colour.');
	});
});

describe('presets', () => {
	it.each(COLOUR_PRESETS.map((preset) => [preset.label, preset] as const))(
		'%s meets every floor and raises no warning',
		(_label, preset) => {
			const palette = resolvePalette(preset.groups);
			expect(floorBreaches(palette)).toEqual([]);
			expect(paletteWarnings(palette)).toEqual([]);
		}
	);

	it('Default is exactly the built-in palette', () => {
		expect(resolvePalette(COLOUR_PRESETS[0].groups)).toEqual(DEFAULT_PALETTE);
	});
});
