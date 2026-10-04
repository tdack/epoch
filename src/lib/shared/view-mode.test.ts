import { describe, expect, it } from 'vitest';
import { LAYOUT_MODES, parseLayoutMode, resolveLayoutMode } from './view-mode';

describe('parseLayoutMode', () => {
	it('accepts the three modes and nothing else', () => {
		expect(parseLayoutMode('flat')).toBe('flat');
		expect(parseLayoutMode('layers')).toBe('layers');
		expect(parseLayoutMode('floors')).toBe('floors');
		expect(parseLayoutMode('orbit')).toBeNull();
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
		expect(resolveLayoutMode({ ...none, fromTree: 'floors' })).toBe('floors');
		expect(resolveLayoutMode({ ...none, fromTree: 'floors', fromMember: 'layers' })).toBe('layers');
		expect(
			resolveLayoutMode({ fromAddress: 'flat', fromMember: 'layers', fromTree: 'floors' })
		).toBe('flat');
	});
});
