import { redirect } from '@sveltejs/kit';
import { fetchTreeList } from '#lib/api/trees.js';
import type { PageLoad } from './$types';
import { treePath } from '#lib/shared/tree-slug.js';

/**
 * `/` is no longer a screen of its own. The old address carried the tree and the view in its query
 * (`/?tree=…&focus=…&up=2`); it moves to the tree's own path and keeps the rest of the query, so
 * bookmarks and shared links still open the same view. A bare `/` opens the user's default tree, else the most recent one, and
 * only a user with no trees at all sees the page below.
 */
export const load: PageLoad = async ({ url, fetch }) => {
	const legacyTreeId = url.searchParams.get('tree');
	if (legacyTreeId) {
		const rest = new URLSearchParams(url.searchParams);
		rest.delete('tree');
		redirect(308, `/trees/${encodeURIComponent(legacyTreeId)}${rest.size > 0 ? `?${rest}` : ''}`);
	}

	const trees = await fetchTreeList(fetch);
	const opening = trees.find((t) => t.isDefault) ?? trees[0];
	if (opening) redirect(302, treePath(opening));
	return { trees };
};
