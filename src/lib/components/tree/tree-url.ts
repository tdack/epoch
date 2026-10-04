/**
 * View state carried in the URL so reloads, back/forward and shared links restore the same tree
 * view. Defaults are omitted to keep links short.
 */

import type { ParentChildType } from '#lib/shared/relationship-model.js';
import { DEFAULT_FOCUS_OPTIONS, MAX_COLLATERAL_DEPTH } from '#lib/tree-layout/index.js';
import { MAX_VIEW_DEPTH, STUB_TOKEN } from '#lib/shared/stub-tokens.js';

export { compactStubId, resolveStubTokens } from '#lib/shared/stub-tokens.js';

/** Every parent-child type, in legend order. The server module holding the values is not importable here. */
export const ALL_PARENT_CHILD_TYPES = [
	'biological',
	'adoptive',
	'foster',
	'guardian',
	'unknown'
] as const satisfies readonly ParentChildType[];
export const MAX_DEPTH = MAX_VIEW_DEPTH;
export { MAX_COLLATERAL_DEPTH };

/** How the tree is drawn: today's hourglass, or one of the 3D views (ADR-030). */
export const LAYOUT_MODES = { FLAT: 'flat', LAYERS: 'layers', FLOORS: 'floors' } as const;
export type LayoutMode = (typeof LAYOUT_MODES)[keyof typeof LAYOUT_MODES];

export interface TreeViewState {
	treeId: string | null;
	focusId: string | null;
	/** The person the details drawer is open on; null when it is closed. It never changes what is fetched. */
	personId: string | null;
	ancestorDepth: number;
	descendantDepth: number;
	shouldIncludeSiblings: boolean;
	shouldIncludeStepFamilies: boolean;
	/** Steps off the direct line fetched and drawn by the 3D views, 0 to 2; flat ignores it. */
	collateralDepth: number;
	/** Fetch and draw the focus person's partners' parents and siblings; flat ignores it. */
	shouldIncludePartnerOrigins: boolean;
	/** Parent-child types drawn; all five by default. */
	types: ParentChildType[];
	/** Which view draws the graph. It never changes what is fetched. */
	layoutMode: LayoutMode;
	/**
	 * The union `layers` is centred on, one of the focus person's. Null means their first. It never
	 * changes what is fetched, and a new focus person starts again from their first.
	 */
	unionId: string | null;
	/** Stubs the user opened, as compact tokens (see `compactStubId`); resolved against the graph by the page. */
	expandedStubs: string[];
}

export const DEFAULT_VIEW_STATE: TreeViewState = {
	treeId: null,
	focusId: null,
	personId: null,
	ancestorDepth: DEFAULT_FOCUS_OPTIONS.ancestorDepth,
	descendantDepth: DEFAULT_FOCUS_OPTIONS.descendantDepth,
	shouldIncludeSiblings: DEFAULT_FOCUS_OPTIONS.shouldIncludeSiblings,
	shouldIncludeStepFamilies: DEFAULT_FOCUS_OPTIONS.shouldIncludeStepFamilies,
	collateralDepth: DEFAULT_FOCUS_OPTIONS.collateralDepth,
	shouldIncludePartnerOrigins: DEFAULT_FOCUS_OPTIONS.shouldIncludePartnerOrigins,
	types: [...ALL_PARENT_CHILD_TYPES],
	layoutMode: LAYOUT_MODES.FLAT,
	unionId: null,
	expandedStubs: []
};

function depth(value: string | null, fallback: number): number {
	if (value === null || !/^\d+$/.test(value)) return fallback;
	return Math.min(MAX_VIEW_DEPTH, Number(value));
}

function collateralDepth(value: string | null, fallback: number): number {
	if (value === null || !/^\d+$/.test(value)) return fallback;
	return Math.min(MAX_COLLATERAL_DEPTH, Number(value));
}

function flag(value: string | null, isDefault: boolean): boolean {
	return value === '1' ? true : value === '0' ? false : isDefault;
}

function layoutMode(value: string | null): LayoutMode {
	return Object.values(LAYOUT_MODES).find((mode) => mode === value) ?? LAYOUT_MODES.FLAT;
}

export function parseViewState(params: Pick<URLSearchParams, 'get'>): TreeViewState {
	const requested = params.get('types');
	const types = requested
		? ALL_PARENT_CHILD_TYPES.filter((t) => requested.split(',').includes(t))
		: [...ALL_PARENT_CHILD_TYPES];
	return {
		treeId: params.get('tree') || null,
		focusId: params.get('focus') || null,
		personId: params.get('person') || null,
		ancestorDepth: depth(params.get('up'), DEFAULT_VIEW_STATE.ancestorDepth),
		descendantDepth: depth(params.get('down'), DEFAULT_VIEW_STATE.descendantDepth),
		shouldIncludeSiblings: flag(params.get('siblings'), DEFAULT_VIEW_STATE.shouldIncludeSiblings),
		shouldIncludeStepFamilies: flag(
			params.get('step'),
			DEFAULT_VIEW_STATE.shouldIncludeStepFamilies
		),
		collateralDepth: collateralDepth(params.get('side'), DEFAULT_VIEW_STATE.collateralDepth),
		shouldIncludePartnerOrigins: flag(
			params.get('origins'),
			DEFAULT_VIEW_STATE.shouldIncludePartnerOrigins
		),
		// An empty or unrecognised list would draw no parentage at all, which is never intended.
		types: types.length > 0 ? types : [...ALL_PARENT_CHILD_TYPES],
		layoutMode: layoutMode(params.get('mode')),
		unionId: params.get('union') || null,
		expandedStubs: (params.get('exp') ?? '').split(',').filter((token) => STUB_TOKEN.test(token))
	};
}

export function serializeViewState(state: TreeViewState): URLSearchParams {
	const params = new URLSearchParams();
	const d = DEFAULT_VIEW_STATE;
	if (state.treeId) params.set('tree', state.treeId);
	if (state.focusId) params.set('focus', state.focusId);
	// An absent parameter means the drawer is closed, which keeps the common link short.
	if (state.personId) params.set('person', state.personId);
	if (state.ancestorDepth !== d.ancestorDepth) params.set('up', String(state.ancestorDepth));
	if (state.descendantDepth !== d.descendantDepth)
		params.set('down', String(state.descendantDepth));
	if (state.shouldIncludeSiblings !== d.shouldIncludeSiblings) {
		params.set('siblings', state.shouldIncludeSiblings ? '1' : '0');
	}
	if (state.shouldIncludeStepFamilies !== d.shouldIncludeStepFamilies) {
		params.set('step', state.shouldIncludeStepFamilies ? '1' : '0');
	}
	if (state.collateralDepth !== d.collateralDepth)
		params.set('side', String(state.collateralDepth));
	if (state.shouldIncludePartnerOrigins !== d.shouldIncludePartnerOrigins) {
		params.set('origins', state.shouldIncludePartnerOrigins ? '1' : '0');
	}
	if (state.types.length !== ALL_PARENT_CHILD_TYPES.length)
		params.set('types', state.types.join(','));
	if (state.layoutMode !== d.layoutMode) params.set('mode', state.layoutMode);
	if (state.unionId) params.set('union', state.unionId);
	if (state.expandedStubs.length > 0) params.set('exp', state.expandedStubs.join(','));
	return params;
}

// ---- History ----

/** Toolbar and stub changes made within this long of the last one share a history entry. */
export const HISTORY_COALESCE_MS = 700;

export const HISTORY_KINDS = { FOCUS: 'focus', ADJUST: 'adjust' } as const;
export type HistoryKind = (typeof HISTORY_KINDS)[keyof typeof HISTORY_KINDS];

/**
 * Decides whether a view change pushes a history entry or replaces the current one. A change of
 * focus always pushes, so Back returns to the previous person. Adjustments (depth, toggles, opened
 * stubs) push once and then replace while the person keeps clicking, so Back undoes the whole burst
 * rather than one step of a stepper.
 */
export function createHistoryCoalescer(now: () => number = Date.now) {
	let lastAdjustAt: number | null = null;
	return {
		shouldReplace(kind: HistoryKind): boolean {
			const at = now();
			if (kind === HISTORY_KINDS.FOCUS) {
				lastAdjustAt = null;
				return false;
			}
			const isBurst = lastAdjustAt !== null && at - lastAdjustAt <= HISTORY_COALESCE_MS;
			lastAdjustAt = at;
			return isBurst;
		}
	};
}
