import { treeServerLoad } from '#lib/server/http/page-load.js';
import { UnionPageService } from '#lib/server/services/union-page-service.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to load the partnership', allowPublicVisitor: true },
	async ({ db, ctx, treeId }, { params }) => ({
		union: await new UnionPageService(db).getUnion(treeId, params.unionId, ctx)
	})
);
