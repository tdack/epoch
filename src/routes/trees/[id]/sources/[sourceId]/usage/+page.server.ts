import { treeServerLoad } from '#lib/server/http/page-load.js';
import { EvidenceReadService } from '#lib/server/services/evidence-read-service.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to load the source usage', allowPublicVisitor: true },
	async ({ db, ctx, treeId }, { params }) => ({
		source: await new EvidenceReadService(db).getSourceUsage(treeId, params.sourceId, ctx)
	})
);
