import { treeHandler } from '#lib/server/http/handler.js';
import { EvidenceService } from '#lib/server/services/evidence-service.js';
import { sourceMergeSchema } from '#lib/server/validation/schemas.js';

/**
 * Fold duplicate sources into this one: their citations move to it, and the merge is one undoable
 * change. One too big for a change moves the citations in steps: `remaining` is those still to move,
 * and the caller repeats the request until it is 0.
 */
export const POST = treeHandler(
	{ failure: 'Failed to merge the sources', params: ['sourceId'], body: sourceMergeSchema },
	async ({ db, ctx, treeId, params, body }) => {
		const { change, remaining = 0 } = await new EvidenceService(db).mergeSources(
			treeId,
			params.sourceId,
			body.mergedIds,
			body.expectedVersions,
			ctx
		);
		return { change, remaining };
	}
);
