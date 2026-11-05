import { parseViewState, type TreeViewState } from './tree-url.js';
import { resolveLayoutMode, type LayoutMode } from '#lib/shared/view-mode.js';

interface SavedViewOptions {
	/** The mode the member chose on their account (ADR-075); null until they make one. */
	savedMemberMode: () => LayoutMode | null;
	/** The address a navigation is heading for, which shows before the load commits it. */
	pendingSearch: () => string | null;
	/** The committed address, with its leading `?`. */
	currentSearch: () => string;
}

/**
 * The view (focus, depths, toggles, opened stubs) lives in the URL so reloads, back/forward and
 * shared links restore it. Everything else derives from it rather than keeping a second copy.
 * Getters throughout because the page can move to another tree without being recreated.
 */
export function createSavedView({
	savedMemberMode,
	pendingSearch,
	currentSearch
}: SavedViewOptions) {
	/** A link with no `mode` opens here; the address wins when it names one. */
	const startingMode = $derived(
		resolveLayoutMode({ fromAddress: null, fromMember: savedMemberMode() })
	);
	const view = $derived<TreeViewState>(
		parseViewState(new URLSearchParams(pendingSearch() ?? currentSearch()), startingMode)
	);
	return {
		get startingMode() {
			return startingMode;
		},
		get view() {
			return view;
		}
	};
}
