import {
	computeHighlight,
	isSourcePresent,
	MAX_TRACE_ITEMS,
	QUIET_HIGHLIGHT,
	toggleTraceItem,
	type Highlight,
	type HighlightSource,
	type KinSource
} from '#lib/tree-layout/highlight.js';
import type { Palette } from '#lib/shared/palette.js';
import { highlightRoles } from './webgl-tree.js';

interface HighlightInputs {
	/** What the highlight is computed over. Its identity matters: see `WebGlTreeShell`. */
	kin: () => KinSource;
	/** The focus person, whose line is lit until something else is selected; null for the whole tree. */
	focusPersonId: () => string | null;
	palette: () => Palette;
}

/** What is lit in a WebGL view, and the selection, clearing and trace mode that decide it. */
export function createHighlightState({ kin, focusPersonId, palette }: HighlightInputs) {
	/**
	 * A partnership, line or (in the whole tree) person selected outside trace mode, with the layout
	 * it was made on: a new layout drops it, as a new focus has always relit the focus line.
	 */
	let selection = $state.raw<{ kin: KinSource; source: HighlightSource } | null>(null);
	/** The layout the viewer cleared the highlight on; clearing keeps everyone where they are. */
	let clearedKin = $state.raw<KinSource | null>(null);
	const isCleared = $derived(clearedKin === kin());
	let isTracing = $state(false);
	/** What trace mode holds. Kept across layouts; what a layout does not draw is simply not lit. */
	let traceItems = $state.raw<HighlightSource[]>([]);
	/** Said in the trace strip and announced: the cap was hit. */
	let notice = $state<string | null>(null);
	const liveTrace = $derived(traceItems.filter((item) => isSourcePresent(kin(), item)));
	const activeSelection = $derived(selection?.kin === kin() ? selection.source : null);
	const highlight = $derived.by<Highlight>(() => {
		if (isCleared) return QUIET_HIGHLIGHT;
		if (isTracing) return computeHighlight(kin(), liveTrace, true, palette());
		if (activeSelection) return computeHighlight(kin(), [activeSelection], false, palette());
		const focus = focusPersonId();
		return focus
			? computeHighlight(kin(), [{ kind: 'focus', personId: focus }], false, palette())
			: QUIET_HIGHLIGHT;
	});
	/** Roles at the level the scenes light people: see {@link highlightRoles}. */
	const roles = $derived(highlightRoles(highlight));

	return {
		get isCleared() {
			return isCleared;
		},
		get isTracing() {
			return isTracing;
		},
		get notice() {
			return notice;
		},
		get liveTrace() {
			return liveTrace;
		},
		get activeSelection() {
			return activeSelection;
		},
		get highlight() {
			return highlight;
		},
		get roles() {
			return roles;
		},
		clearHighlight() {
			clearedKin = kin();
		},
		/** Light everyone again after the viewer cleared the highlight. */
		restoreHighlight() {
			clearedKin = null;
		},
		/** Select a source on the current layout, or `null` to drop the selection; either lights again. */
		select(source: HighlightSource | null) {
			selection = source ? { kin: kin(), source } : null;
			clearedKin = null;
		},
		toggleTrace(source: HighlightSource) {
			const change = toggleTraceItem(liveTrace, source);
			if (change.result === 'full') {
				notice = `Trace holds at most ${MAX_TRACE_ITEMS} items. Remove one to add another.`;
				return;
			}
			notice = null;
			clearedKin = null;
			traceItems = change.items;
		},
		/** Empty the trace but stay in trace mode. */
		clearTrace() {
			traceItems = [];
			notice = null;
		},
		setTracing(isOn: boolean) {
			isTracing = isOn;
			notice = null;
			selection = null;
			clearedKin = null;
			if (!isOn) traceItems = [];
		}
	};
}
