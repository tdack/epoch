/**
 * The toolbar's "Display" settings: what is drawn around the focus person, as opposed to which
 * view draws it. Defaults depend on the view because arriving at Layers asks for the wider groups
 * (see the chart page); counting against the flat defaults would badge every Layers visit.
 */

import {
	ALL_PARENT_CHILD_TYPES,
	DEFAULT_VIEW_STATE,
	LAYOUT_MODES,
	type LayoutMode,
	type TreeViewState,
	wideGroupDefaults
} from './tree-url.js';

type DisplayFields = Pick<
	TreeViewState,
	| 'shouldIncludeSiblings'
	| 'shouldIncludeStepFamilies'
	| 'collateralDepth'
	| 'shouldIncludePartnerOrigins'
	| 'types'
>;

/** What the Display settings are when nobody has touched them, in this view. */
export function displayDefaults(mode: LayoutMode): DisplayFields {
	const wide = wideGroupDefaults(mode);
	return {
		shouldIncludeSiblings: DEFAULT_VIEW_STATE.shouldIncludeSiblings,
		shouldIncludeStepFamilies: DEFAULT_VIEW_STATE.shouldIncludeStepFamilies,
		...wide,
		types: [...ALL_PARENT_CHILD_TYPES]
	};
}

/**
 * How many Display settings differ from their defaults. The parent-link toggles count once however
 * many are off, and flat ignores the wider groups, so those two are not counted there.
 */
export function countDisplayChanges(view: TreeViewState): number {
	const d = displayDefaults(view.layoutMode);
	const hasWiderGroups = view.layoutMode !== LAYOUT_MODES.FLAT;
	return [
		view.shouldIncludeSiblings !== d.shouldIncludeSiblings,
		view.shouldIncludeStepFamilies !== d.shouldIncludeStepFamilies,
		hasWiderGroups && view.collateralDepth !== d.collateralDepth,
		hasWiderGroups && view.shouldIncludePartnerOrigins !== d.shouldIncludePartnerOrigins,
		view.types.length !== d.types.length
	].filter(Boolean).length;
}
