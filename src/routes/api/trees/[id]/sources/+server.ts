import { treeHandler } from '#lib/server/http/handler.js';
import { EvidenceService } from '#lib/server/services/evidence-service.js';
import { sourceCreateSchema } from '#lib/server/validation/schemas.js';

/** Make a source. Nothing cites it yet; a citation names it. */
export const POST = treeHandler(
	{ failure: 'Failed to add the source', body: sourceCreateSchema, status: 201 },
	async ({ db, ctx, treeId, body }) => {
		const { sourceId, change } = await new EvidenceService(db).createSource(treeId, body, ctx);
		return { sourceId, change };
	}
);
