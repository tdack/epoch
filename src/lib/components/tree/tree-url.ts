/**
 * View state carried in the URL so reloads, back/forward and shared links restore the same tree
 * view. Defaults are omitted to keep links short.
 */

import type { ParentChildType } from '#lib/server/domain/genealogy-model.js';
import { DEFAULT_FOCUS_OPTIONS } from '#lib/tree-layout/index.js';

/** Every parent-child type, in legend order. The server module holding the values is not importable here. */
export const ALL_PARENT_CHILD_TYPES = ['biological', 'adoptive', 'foster', 'guardian', 'unknown'] as const satisfies readonly ParentChildType[];
export const MAX_DEPTH = 8;

export interface TreeViewState {
	treeId: string | null;
	focusId: string | null;
	ancestorDepth: number;
	descendantDepth: number;
	shouldIncludeSiblings: boolean;
	shouldIncludeStepFamilies: boolean;
	/** Parent-child types drawn; all five by default. */
	types: ParentChildType[];
}

export const DEFAULT_VIEW_STATE: TreeViewState = {
	treeId: null,
	focusId: null,
	ancestorDepth: DEFAULT_FOCUS_OPTIONS.ancestorDepth,
	descendantDepth: DEFAULT_FOCUS_OPTIONS.descendantDepth,
	shouldIncludeSiblings: DEFAULT_FOCUS_OPTIONS.shouldIncludeSiblings,
	shouldIncludeStepFamilies: DEFAULT_FOCUS_OPTIONS.shouldIncludeStepFamilies,
	types: [...ALL_PARENT_CHILD_TYPES]
};

function depth(value: string | null, fallback: number): number {
	if (value === null || !/^\d+$/.test(value)) return fallback;
	return Math.min(MAX_DEPTH, Number(value));
}

function flag(value: string | null, fallback: boolean): boolean {
	return value === '1' ? true : value === '0' ? false : fallback;
}

export function parseViewState(params: Pick<URLSearchParams, 'get'>): TreeViewState {
	const requested = params.get('types');
	const types = requested
		? ALL_PARENT_CHILD_TYPES.filter((t) => requested.split(',').includes(t))
		: [...ALL_PARENT_CHILD_TYPES];
	return {
		treeId: params.get('tree') || null,
		focusId: params.get('focus') || null,
		ancestorDepth: depth(params.get('up'), DEFAULT_VIEW_STATE.ancestorDepth),
		descendantDepth: depth(params.get('down'), DEFAULT_VIEW_STATE.descendantDepth),
		shouldIncludeSiblings: flag(params.get('siblings'), DEFAULT_VIEW_STATE.shouldIncludeSiblings),
		shouldIncludeStepFamilies: flag(params.get('step'), DEFAULT_VIEW_STATE.shouldIncludeStepFamilies),
		// An empty or unrecognised list would draw no parentage at all, which is never intended.
		types: types.length > 0 ? types : [...ALL_PARENT_CHILD_TYPES]
	};
}

export function serializeViewState(state: TreeViewState): URLSearchParams {
	const params = new URLSearchParams();
	const d = DEFAULT_VIEW_STATE;
	if (state.treeId) params.set('tree', state.treeId);
	if (state.focusId) params.set('focus', state.focusId);
	if (state.ancestorDepth !== d.ancestorDepth) params.set('up', String(state.ancestorDepth));
	if (state.descendantDepth !== d.descendantDepth) params.set('down', String(state.descendantDepth));
	if (state.shouldIncludeSiblings !== d.shouldIncludeSiblings) {
		params.set('siblings', state.shouldIncludeSiblings ? '1' : '0');
	}
	if (state.shouldIncludeStepFamilies !== d.shouldIncludeStepFamilies) {
		params.set('step', state.shouldIncludeStepFamilies ? '1' : '0');
	}
	if (state.types.length !== ALL_PARENT_CHILD_TYPES.length) params.set('types', state.types.join(','));
	return params;
}
