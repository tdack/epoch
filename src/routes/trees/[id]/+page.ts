import { parseViewState } from '#lib/components/tree/tree-url.js';
import { rememberedFocusKey, treeLoad } from '#lib/api/load-helpers.js';
import { resolveLayoutMode } from '#lib/shared/view-mode.js';
import { ApiError } from '#lib/api/client.js';
import { fetchFocusGraph, fetchWholeTreeGraph } from '#lib/api/trees.js';
import type { PageLoad } from './$types';

// The remembered focus lives in localStorage, and the canvas needs the browser anyway.
// SvelteKit reads this exact name, so it cannot take the boolean prefix.
// eslint-disable-next-line @typescript-eslint/naming-convention
export const ssr = false;

/** The URL parameters that shape the request. `types` is deliberately absent: it filters the drawing, not the fetch. */
const FETCHED_PARAMS = new Set([
	'focus',
	'up',
	'down',
	'siblings',
	'step',
	'side',
	'origins',
	'exp',
	// The wider groups default on in the WebGL views, so the mode decides what a bare address fetches.
	'mode',
	// The whole tree is a different request; see the load.
	'scope'
]);

function rememberedFocus(treeId: string, subtreeId: string | null): string | null {
	try {
		return localStorage.getItem(rememberedFocusKey(treeId, subtreeId));
	} catch {
		// Storage can be unavailable (private mode, blocked site data); the default still works.
		return null;
	}
}

/**
 * The bounded graph around the focus person: the URL's, else the member's starting person, else the member's
 * own person, else the last one viewed, else the tree's first. A starting, remembered or requested person who no longer exists falls back to the default rather
 * than showing an error page for a stale bookmark.
 */
export const load: PageLoad = treeLoad(async ({ params, url, fetch, parent }) => {
	const { summary, trees } = await parent();
	// Read only the parameters that change what is fetched, so toggling a relationship type redraws
	// without a request.
	const saved = trees.find((t) => t.id === summary.tree.id);
	// Same fallback as the page, or a link without a mode would fetch for one view and draw another.
	const fallbackMode = resolveLayoutMode({
		fromAddress: null,
		fromMember: saved?.viewMode ?? null
	});
	const modeAndScope = parseViewState(
		{ get: (key) => (key === 'mode' || key === 'scope' ? url.searchParams.get(key) : null) },
		fallbackMode
	);
	if (modeAndScope.isWholeTree) {
		// Everyone the viewer may see, anchored to no one. Reading only `mode` and `scope` above is
		// deliberate: a new focus, depth or option then does not re-run this load or refetch.
		return { focusGraph: await fetchWholeTreeGraph(params.id, fetch), applied: modeAndScope };
	}
	const view = parseViewState(
		{ get: (key) => (FETCHED_PARAMS.has(key) ? url.searchParams.get(key) : null) },
		fallbackMode
	);
	const query = {
		up: view.ancestorDepth,
		down: view.descendantDepth,
		shouldIncludeSiblings: view.shouldIncludeSiblings,
		shouldIncludeStepFamilies: view.shouldIncludeStepFamilies,
		collateralDepth: view.collateralDepth,
		shouldIncludePartnerOrigins: view.shouldIncludePartnerOrigins,
		exp: view.expandedStubs
	};

	// Inside a lens: the address, what was last viewed in this lens, the lens's root, then the tree's.
	// Outside one, the member's chosen starting person sits between the address and what was last
	// viewed, and the member's own person comes after that; a lens keeps its own order, since neither
	// may belong to it.
	const lens = summary.subtree;
	const candidates = [
		view.focusId,
		lens ? null : (saved?.homePersonId ?? null),
		lens ? null : (saved?.selfPersonId ?? null),
		rememberedFocus(summary.tree.id, lens?.id ?? null),
		lens?.rootPersonId ?? null,
		summary.defaultFocusPersonId
	].filter((id, index, all): id is string => id !== null && all.indexOf(id) === index);
	for (const [index, focusId] of candidates.entries()) {
		try {
			// `applied` is what this graph was fetched for. The canvas draws with it, not with the
			// address, which runs ahead of the data while a request is in flight.
			return {
				focusGraph: await fetchFocusGraph(params.id, focusId, query, fetch),
				applied: view
			};
		} catch (cause) {
			const isLast = index === candidates.length - 1;
			if (!(cause instanceof ApiError && cause.status === 404) || isLast) throw cause;
		}
	}
	return { focusGraph: null, applied: view };
});
