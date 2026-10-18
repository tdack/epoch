import { error } from '@sveltejs/kit';
import { treeLoad } from '#lib/api/load-helpers.js';
import { fetchPersonPage } from '#lib/api/people.js';
import { fetchSubtrees } from '#lib/api/subtrees.js';
import { fetchInstallTrees } from '#lib/api/trees.js';
import type { PageLoad } from './$types';

/**
 * The install owner sees every tree in the install, from an endpoint that refuses anyone else; a
 * member sees their own, which the layout has already loaded. The public visitor has one tree and
 * nothing to choose, so the page is not theirs.
 */
export const load: PageLoad = treeLoad(async ({ fetch, parent }) => {
	const { summary } = await parent();
	if (summary.viewer.isPublicVisitor) error(404, 'Not found');
	const treeId = summary.tree.id;
	const [installTrees, subtrees] = await Promise.all([
		summary.viewer.isInstallOwner ? fetchInstallTrees(fetch) : null,
		fetchSubtrees(treeId, fetch)
	]);
	// The list carries ids only; a root the viewer cannot open (deleted, or hidden by privacy) has no
	// name to show, and the row says so rather than failing the page.
	const rootNames: Record<string, string> = {};
	await Promise.all(
		subtrees
			.filter((s) => !s.isRootMissing)
			.map(async (s) => {
				try {
					rootNames[s.rootPersonId] = (
						await fetchPersonPage(treeId, s.rootPersonId, fetch)
					).person.displayName;
				} catch {
					// Left out on purpose.
				}
			})
	);
	return { installTrees, subtrees, rootNames };
});
