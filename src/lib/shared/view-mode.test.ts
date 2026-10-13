import { describe, expect, it } from 'vitest';
import {
	LAYOUT_MODES,
	LAYOUT_MODE_VALUES,
	RINGS_ARRIVAL_DEPTH,
	VIEW_MODE_TRAITS,
	WEBGL_LAYOUT_MODES,
	layoutModeChoices,
	parseLayoutMode,
	resolveLayoutMode
} from './view-mode';

describe('parseLayoutMode', () => {
	it('accepts the six modes and nothing else', () => {
		expect(parseLayoutMode('flat')).toBe('flat');
		expect(parseLayoutMode('layers')).toBe('layers');
		expect(parseLayoutMode('rings')).toBe('rings');
		expect(parseLayoutMode('poincare')).toBe('poincare');
		expect(parseLayoutMode('ribbons')).toBe('ribbons');
		expect(parseLayoutMode('orrery')).toBe('orrery');
		expect(parseLayoutMode('orbit')).toBeNull();
		// Removed (ADR-047): a saved default or old link naming it falls through to the next choice.
		expect(parseLayoutMode('floors')).toBeNull();
		expect(parseLayoutMode(null)).toBeNull();
		expect(parseLayoutMode(undefined)).toBeNull();
		expect(parseLayoutMode(3)).toBeNull();
	});
});

describe('resolveLayoutMode', () => {
	const none = { fromAddress: null, fromMember: null, fromTree: null };

	it('is flat when nobody has chosen', () => {
		expect(resolveLayoutMode(none)).toBe(LAYOUT_MODES.FLAT);
	});

	it('prefers the address, then the member, then the tree', () => {
		expect(resolveLayoutMode({ ...none, fromTree: 'rings' })).toBe('rings');
		expect(resolveLayoutMode({ ...none, fromTree: 'rings', fromMember: 'layers' })).toBe('layers');
		expect(
			resolveLayoutMode({ fromAddress: 'flat', fromMember: 'layers', fromTree: 'rings' })
		).toBe('flat');
	});
});

describe('layoutModeChoices', () => {
	const offered = ['flat', 'rings', 'poincare', 'ribbons', 'orrery'];

	it('offers flat and the WebGL views, keeping layers off the controls', () => {
		expect(layoutModeChoices(null)).toEqual(offered);
		expect(layoutModeChoices('rings')).toEqual(offered);
	});

	it('still lists a withdrawn view while it is the one in force', () => {
		expect(layoutModeChoices('layers')).toEqual(['flat', 'layers', ...offered.slice(1)]);
	});
});

describe('VIEW_MODE_TRAITS', () => {
	it('has a row for every mode', () => {
		expect(Object.keys(VIEW_MODE_TRAITS).sort()).toEqual([...LAYOUT_MODE_VALUES].sort());
	});

	it('keeps the existing views as they were', () => {
		const wider = LAYOUT_MODE_VALUES.filter((mode) => VIEW_MODE_TRAITS[mode].shouldAskWiderGroups);
		expect(wider).toEqual(['layers', 'rings', 'poincare', 'ribbons', 'orrery']);
		expect(VIEW_MODE_TRAITS.rings.arrivalDepth).toBe(RINGS_ARRIVAL_DEPTH);
		expect(VIEW_MODE_TRAITS.layers.arrivalDepth).toBeNull();
	});

	it('draws the WebGL views read-only', () => {
		expect(WEBGL_LAYOUT_MODES).toEqual(['rings', 'poincare', 'ribbons', 'orrery']);
		for (const mode of WEBGL_LAYOUT_MODES) expect(VIEW_MODE_TRAITS[mode].canEdit).toBe(false);
	});
});
