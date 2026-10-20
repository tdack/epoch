import type { ImpactResponse } from '#lib/shared/api-contracts.js';
import { treeHandler } from '#lib/server/http/handler.js';
import { EvidenceService } from '#lib/server/services/evidence-service.js';
import { citationPeopleSchema } from '#lib/server/validation/schemas.js';

/** Preview citing a source for several people. Saves nothing. */
export const POST = treeHandler(
	{ failure: 'Failed to preview the citations', body: citationPeopleSchema },
	async ({ db, ctx, treeId, body: { personIds, ...citation } }): Promise<ImpactResponse> => ({
		impact: await new EvidenceService(db).previewMany(
			treeId,
			citation.sourceId,
			personIds,
			citation,
			ctx
		)
	})
);
