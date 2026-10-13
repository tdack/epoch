import { redirect } from '@sveltejs/kit';
import { fetchTreeList } from '#lib/services/tree-api.js';
import type { PageLoad } from './$types';
import { treePath } from '#lib/shared/tree-slug.js';

/**
 * The Trees page now lives under a tree, so it keeps the header and the section menu. Old links
 * still land on it: in the tree they came from when they name one, else in the default tree.
 */
export const load: PageLoad = async ({ url, fetch }) => {
	const from = url.searchParams.get('from');
	const trees = from ? [] : await fetchTreeList(fetch);
	const tree = from ? { id: from } : (trees.find((t) => t.isDefault) ?? trees[0]);
	redirect(308, tree ? `${treePath(tree)}/trees` : '/');
};
