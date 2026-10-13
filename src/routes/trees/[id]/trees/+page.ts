import { error } from '@sveltejs/kit';
import { treeLoad } from '#lib/services/load-helpers.js';
import { fetchInstallTrees } from '#lib/services/tree-api.js';
import type { PageLoad } from './$types';

/**
 * The install owner sees every tree in the install, from an endpoint that refuses anyone else; a
 * member sees their own, which the layout has already loaded. The public visitor has one tree and
 * nothing to choose, so the page is not theirs.
 */
export const load: PageLoad = treeLoad(async ({ fetch, parent }) => {
	const { summary } = await parent();
	if (summary.viewer.isPublicVisitor) error(404, 'Not found');
	return { installTrees: summary.viewer.isInstallOwner ? await fetchInstallTrees(fetch) : null };
});
