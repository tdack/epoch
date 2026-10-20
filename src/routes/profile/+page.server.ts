import { redirect } from '@sveltejs/kit';
import { serverLoad } from '#lib/server/http/page-load.js';
import { TreeService } from '#lib/server/services/tree-service.js';
import { treePath } from '#lib/shared/tree-slug.js';
import type { PageServerLoad } from './$types';

/** Opens the profile in the default tree, else the most recent one, as `/settings` does, to keep the header. */
export const load: PageServerLoad = serverLoad(
	{ failure: 'Failed to load trees' },
	async ({ db, ctx }) => {
		const trees = await new TreeService(db).listTrees(ctx);
		const tree = trees.find((t) => t.isDefault) ?? trees[0];
		// Not permanent: the default tree can change.
		if (tree) redirect(302, `${treePath(tree)}/profile`);
		return {};
	}
);
