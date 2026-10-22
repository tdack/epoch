import { describe, expect, it } from 'vitest';
import {
	LAYOUT_MODES,
	LAYOUT_MODE_VALUES,
	RINGS_ARRIVAL_DEPTH,
	VIEW_MODE_TRAITS,
	WEBGL_LAYOUT_MODES,
	parseLayoutMode,
	resolveLayoutMode
} from './view-mode';

describe('parseLayoutMode', () => {
	it('accepts the five modes and nothing else', () => {
		expect(parseLayoutMode('flat')).toBe('flat');
		expect(parseLayoutMode('rings')).toBe('rings');
		expect(parseLayoutMode('poincare')).toBe('poincare');
		expect(parseLayoutMode('ribbons')).toBe('ribbons');
		expect(parseLayoutMode('orrery')).toBe('orrery');
		expect(parseLayoutMode('orbit')).toBeNull();
		// Removed (ADR-047): a saved default or old link naming one falls through to the next choice.
		expect(parseLayoutMode('floors')).toBeNull();
		expect(parseLayoutMode('layers')).toBeNull();
		expect(parseLayoutMode(null)).toBeNull();
		expect(parseLayoutMode(undefined)).toBeNull();
		expect(parseLayoutMode(3)).toBeNull();
	});
});

describe('resolveLayoutMode', () => {
	const none = { fromAddress: null, fromMember: null };

	it('is flat when nobody has chosen', () => {
		expect(resolveLayoutMode(none)).toBe(LAYOUT_MODES.FLAT);
	});

	it('prefers the address, then the member', () => {
		expect(resolveLayoutMode({ ...none, fromMember: 'orrery' })).toBe('orrery');
		expect(resolveLayoutMode({ fromAddress: 'flat', fromMember: 'orrery' })).toBe('flat');
		expect(resolveLayoutMode({ fromAddress: 'rings', fromMember: null })).toBe('rings');
	});
});

describe('VIEW_MODE_TRAITS', () => {
	it('has a row for every mode', () => {
		expect(Object.keys(VIEW_MODE_TRAITS).sort()).toEqual([...LAYOUT_MODE_VALUES].sort());
	});

	it('keeps the existing views as they were', () => {
		const wider = LAYOUT_MODE_VALUES.filter((mode) => VIEW_MODE_TRAITS[mode].shouldAskWiderGroups);
		expect(wider).toEqual(['rings', 'poincare', 'ribbons', 'orrery']);
		expect(VIEW_MODE_TRAITS.rings.arrivalDepth).toBe(RINGS_ARRIVAL_DEPTH);
		expect(VIEW_MODE_TRAITS.flat.arrivalDepth).toBeNull();
	});

	it('lists the WebGL views', () => {
		expect(WEBGL_LAYOUT_MODES).toEqual(['rings', 'poincare', 'ribbons', 'orrery']);
	});
});
