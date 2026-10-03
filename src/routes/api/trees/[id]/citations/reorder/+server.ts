import { treeHandler } from '#lib/server/http/handler.js';
import { EvidenceService } from '#lib/server/services/evidence-service.js';
import { citationReorderSchema } from '#lib/server/validation/schemas.js';

/** Put one record's citations in a new order: the order they are shown and written to GEDCOM. */
export const POST = treeHandler(
	{ failure: 'Failed to reorder the citations', body: citationReorderSchema },
	async ({ db, ctx, treeId, body }) => {
		const { change } = await new EvidenceService(db).reorderCitations(
			treeId,
			body.subject,
			body.orderedCitationIds,
			ctx
		);
		return { change };
	}
);
