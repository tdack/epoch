import { serverLoad } from '#lib/server/http/page-load.js';
import { TreeService } from '#lib/server/services/tree-service.js';
import type { LayoutServerLoad } from './$types';

/**
 * The app header's tree list, for the pages that are about the person or the install rather than
 * one tree (ADR-075). The public visitor has no such page, so the loader refuses them by default.
 */
export const load: LayoutServerLoad = serverLoad(
	{ failure: 'Failed to load trees' },
	async ({ db, ctx }) => ({
		trees: await new TreeService(db).listTrees(ctx),
		isInstallOwner: ctx.user.isInstallOwner
	})
);
