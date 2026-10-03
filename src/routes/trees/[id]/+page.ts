import { parseViewState } from '#lib/components/tree/tree-url.js';
import { rememberedFocusKey, treeLoad } from '#lib/services/load-helpers.js';
import { ApiError, fetchFocusGraph } from '#lib/services/tree-api.js';
import type { PageLoad } from './$types';

// The remembered focus lives in localStorage, and the canvas needs the browser anyway.
// SvelteKit reads this exact name, so it cannot take the boolean prefix.
// eslint-disable-next-line @typescript-eslint/naming-convention
export const ssr = false;

/** The URL parameters that shape the request. `types` is deliberately absent: it filters the drawing, not the fetch. */
const FETCHED_PARAMS = new Set(['focus', 'up', 'down', 'siblings', 'step', 'exp']);

function rememberedFocus(treeId: string): string | null {
	try {
		return localStorage.getItem(rememberedFocusKey(treeId));
	} catch {
		// Storage can be unavailable (private mode, blocked site data); the default still works.
		return null;
	}
}

/**
 * The bounded graph around the focus person: the URL's, else the last one viewed, else the tree's
 * first. A remembered or requested person who no longer exists falls back to the default rather
 * than showing an error page for a stale bookmark.
 */
export const load: PageLoad = treeLoad(async ({ params, url, fetch, parent }) => {
	const { summary } = await parent();
	// Read only the parameters that change what is fetched, so toggling a relationship type redraws
	// without a request.
	const view = parseViewState({
		get: (key) => (FETCHED_PARAMS.has(key) ? url.searchParams.get(key) : null)
	});
	const query = {
		up: view.ancestorDepth,
		down: view.descendantDepth,
		shouldIncludeSiblings: view.shouldIncludeSiblings,
		shouldIncludeStepFamilies: view.shouldIncludeStepFamilies,
		exp: view.expandedStubs
	};

	const candidates = [
		view.focusId,
		rememberedFocus(params.id),
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
