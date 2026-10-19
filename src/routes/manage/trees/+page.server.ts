import { redirect } from '@sveltejs/kit';
import { serverLoad } from '#lib/server/http/page-load.js';
import { TreeService } from '#lib/server/services/tree-service.js';
import { treePath } from '#lib/shared/tree-slug.js';
import type { PageServerLoad } from './$types';

/**
 * The Trees page now lives under a tree, so it keeps the header and the section menu. Old links
 * still land on it: in the tree they came from when they name one, else in the default tree.
 */
export const load: PageServerLoad = serverLoad(
	{ failure: 'Failed to load trees', allowPublicVisitor: true },
	async ({ db, ctx }, { url }) => {
		const from = url.searchParams.get('from');
		const trees = from ? [] : await new TreeService(db).listTrees(ctx);
		const tree = from ? { id: from } : (trees.find((t) => t.isDefault) ?? trees[0]);
		// Not permanent: without `?from=` the target is this user's default, which they can change.
		redirect(302, tree ? `${treePath(tree)}/trees` : '/');
	}
);
