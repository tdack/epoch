import { redirect } from '@sveltejs/kit';
import { fetchTreeList } from '#lib/api/trees.js';
import { treePath } from '#lib/shared/tree-slug.js';
import type { PageLoad } from './$types';

/**
 * Settings are the person's, but the page lives under a tree for its header and menu: open it in
 * the default tree, else the most recent one. Someone with no tree is shown the page below.
 */
export const load: PageLoad = async ({ fetch }) => {
	const trees = await fetchTreeList(fetch);
	const tree = trees.find((t) => t.isDefault) ?? trees[0];
	// Not permanent: the default tree can change.
	if (tree) redirect(302, `${treePath(tree)}/settings`);
	return {};
};
