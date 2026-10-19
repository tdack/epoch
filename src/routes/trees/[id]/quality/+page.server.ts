import { treeServerLoad } from '#lib/server/http/page-load.js';
import { QualityService } from '#lib/server/services/quality-service.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to load the report' },
	async ({ db, ctx, treeId }) => ({ report: await new QualityService(db).report(treeId, ctx) })
);
