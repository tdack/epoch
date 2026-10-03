import { treeHandler } from '#lib/server/http/handler.js';
import { EvidenceService } from '#lib/server/services/evidence-service.js';
import { citationCreateSchema } from '#lib/server/validation/schemas.js';

/**
 * Cite a source for one person, name, fact, partnership or parent link. A subject has as many
 * citations as it has sources; they are kept in the order they were added.
 */
export const POST = treeHandler(
	{ failure: 'Failed to add the citation', body: citationCreateSchema, status: 201 },
	async ({ db, ctx, treeId, body: { subject, ...citation } }) => {
		const { citationId, change } = await new EvidenceService(db).addCitation(
			treeId,
			subject,
			citation,
			ctx
		);
		return { citationId, change };
	}
);
