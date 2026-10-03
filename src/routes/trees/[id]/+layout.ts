import { fetchMarks, fetchTreeList, fetchTreeSummary } from '#lib/services/tree-api.js';
import { treeLoad } from '#lib/services/load-helpers.js';
import type { LayoutLoad } from './$types';

/** What every screen under a tree needs: the tree list, this tree's name and counts, and the user's shortcuts. */
export const load: LayoutLoad = treeLoad(async ({ params, fetch }) => {
	// Shortcuts are a convenience: a failure to load them must not take the tree page down.
	const marks = fetchMarks(params.id, fetch).catch(() => ({ favorites: [], recents: [] }));
	const [trees, summary] = await Promise.all([
		fetchTreeList(fetch),
		fetchTreeSummary(params.id, fetch)
	]);
	return { trees, summary, marks: await marks };
});
