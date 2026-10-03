import { treeHandler } from '#lib/server/http/handler.js';
import { EvidenceService } from '#lib/server/services/evidence-service.js';
import { sourceMergeSchema } from '#lib/server/validation/schemas.js';

/** Fold duplicate sources into this one: their citations move to it, and the merge is one undoable change. */
export const POST = treeHandler(
	{ failure: 'Failed to merge the sources', params: ['sourceId'], body: sourceMergeSchema },
	async ({ db, ctx, treeId, params, body }) => {
		const { change } = await new EvidenceService(db).mergeSources(
			treeId,
			params.sourceId,
			body.mergedIds,
			body.expectedVersions,
			ctx
		);
		return { change };
	}
);
