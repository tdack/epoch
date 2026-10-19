import { redirect } from '@sveltejs/kit';
import { serverLoad } from '#lib/server/http/page-load.js';
import { TreeService } from '#lib/server/services/tree-service.js';
import { treePath } from '#lib/shared/tree-slug.js';
import type { PageServerLoad } from './$types';

/**
 * Settings are the person's, but the page lives under a tree for its header and menu: open it in
 * the default tree, else the most recent one. Someone with no tree is shown the page below.
 */
export const load: PageServerLoad = serverLoad(
	{ failure: 'Failed to load trees', allowPublicVisitor: true },
	async ({ db, ctx }) => {
		const trees = await new TreeService(db).listTrees(ctx);
		const tree = trees.find((t) => t.isDefault) ?? trees[0];
		// Not permanent: the default tree can change.
		if (tree) redirect(302, `${treePath(tree)}/settings`);
		return {};
	}
);
