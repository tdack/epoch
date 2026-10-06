import { describe, expect, it } from 'vitest';
import { countDisplayChanges, displayDefaults } from './display-settings.js';
import {
	DEFAULT_VIEW_STATE,
	LAYERS_DEFAULT_COLLATERAL_DEPTH,
	LAYOUT_MODES,
	type TreeViewState
} from './tree-url.js';

const layers = (change: Partial<TreeViewState> = {}): TreeViewState => ({
	...DEFAULT_VIEW_STATE,
	layoutMode: LAYOUT_MODES.LAYERS,
	...displayDefaults(LAYOUT_MODES.LAYERS),
	...change
});

describe('countDisplayChanges', () => {
	it('is zero for the defaults of each view', () => {
		expect(countDisplayChanges(DEFAULT_VIEW_STATE)).toBe(0);
		expect(countDisplayChanges(layers())).toBe(0);
	});

	it('does not badge the wider groups Layers asks for on arrival', () => {
		expect(displayDefaults(LAYOUT_MODES.LAYERS).collateralDepth).toBe(
			LAYERS_DEFAULT_COLLATERAL_DEPTH
		);
		expect(countDisplayChanges(layers({ collateralDepth: 0 }))).toBe(1);
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
