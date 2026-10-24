import type { CitePeopleResponse } from '#lib/shared/api-contracts.js';
import { treeHandler } from '#lib/server/http/handler.js';
import { EvidenceService } from '#lib/server/services/evidence-service.js';
import { citationPeopleSchema } from '#lib/server/validation/schemas.js';

/** Cite one source for each of several people, as a citation on each person, in one change. */
export const POST = treeHandler(
	{ failure: 'Failed to add the citations', body: citationPeopleSchema, status: 201 },
	async ({
		db,
		ctx,
		treeId,
		body: { personIds, factType, ...citation }
	}): Promise<CitePeopleResponse> => {
		const { skippedPersonIds, missingFactPersonIds, change } = await new EvidenceService(
			db
		).citeMany(treeId, citation.sourceId, personIds, citation, factType, ctx);
		return { skippedPersonIds, missingFactPersonIds, change };
	}
);
