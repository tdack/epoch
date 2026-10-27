import { treeServerLoad } from '#lib/server/http/page-load.js';
import { UnionPageService } from '#lib/server/services/union-page-service.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to load the family group sheet', allowPublicVisitor: true },
	async ({ db, ctx, treeId }, { params }) => ({
		sheet: await new UnionPageService(db).getGroupSheet(treeId, params.unionId, ctx)
	})
);
