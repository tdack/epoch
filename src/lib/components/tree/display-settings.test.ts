import { describe, expect, it } from 'vitest';
import { countDisplayChanges, displayDefaults } from './display-settings.js';
import {
	DEFAULT_VIEW_STATE,
	ARRIVAL_COLLATERAL_DEPTH,
	LAYOUT_MODES,
	type TreeViewState
} from './tree-url.js';

const rings = (change: Partial<TreeViewState> = {}): TreeViewState => ({
	...DEFAULT_VIEW_STATE,
	layoutMode: LAYOUT_MODES.RINGS,
	...displayDefaults(LAYOUT_MODES.RINGS),
	...change
});

describe('countDisplayChanges', () => {
	it('is zero for the defaults of each view', () => {
		expect(countDisplayChanges(DEFAULT_VIEW_STATE)).toBe(0);
		expect(countDisplayChanges(rings())).toBe(0);
	});

	it('does not badge the wider groups a WebGL view asks for on arrival', () => {
		expect(displayDefaults(LAYOUT_MODES.RINGS).collateralDepth).toBe(ARRIVAL_COLLATERAL_DEPTH);
		expect(countDisplayChanges(rings({ collateralDepth: 0 }))).toBe(1);
	});

	it('counts each changed toggle, and the parent links once', () => {
		const view = {
			...DEFAULT_VIEW_STATE,
			shouldIncludeSiblings: false,
			shouldIncludeStepFamilies: true,
			types: ['biological' as const]
		};
		expect(countDisplayChanges(view)).toBe(3);
	});

	it('ignores side branches and partner families in the flat view', () => {
		expect(countDisplayChanges({ ...DEFAULT_VIEW_STATE, collateralDepth: 2 })).toBe(0);
	});
});
