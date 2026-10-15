import { redirect } from '@sveltejs/kit';
import { fetchMarks } from '#lib/api/lists.js';
import { fetchTreeList, fetchTreeSummary } from '#lib/api/trees.js';
import { treeLoad } from '#lib/api/load-helpers.js';
import { canonicalTreeAddress } from '#lib/shared/tree-slug.js';
import type { LayoutLoad } from './$types';

/** What every screen under a tree needs: the tree list, this tree's name and counts, and the user's shortcuts. */
export const load: LayoutLoad = treeLoad(async ({ params, fetch, url }) => {
	// Shortcuts are a convenience: a failure to load them must not take the tree page down.
	const marks = fetchMarks(params.id, fetch).catch(() => ({ favorites: [], recents: [] }));
	const [trees, summary] = await Promise.all([
		fetchTreeList(fetch),
		fetchTreeSummary(params.id, fetch)
	]);
	// An address by id, from an old bookmark or a link that only knew the id, moves to the slug, so
	// the address bar always shows the readable form and one tree has one address (ADR-045).
	const canonical = canonicalTreeAddress(url, params.id, summary.tree);
	// Not permanent: a browser caches a 308, and the slug can be changed or given up.
	if (canonical) redirect(302, canonical);
	return { trees, summary, marks: await marks };
});
