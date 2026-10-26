import { treeServerLoad } from '#lib/server/http/page-load.js';
import { OverviewService } from '#lib/server/services/overview-service.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to load the overview', allowPublicVisitor: true },
	async ({ db, ctx, treeId }) => ({ overview: await new OverviewService(db).load(treeId, ctx) })
);
