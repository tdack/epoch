import { treeHandler } from '#lib/server/http/handler.js';
import { PersonMergeService } from '#lib/server/services/person-merge-service.js';
import { personMergeSchema } from '#lib/server/validation/schemas.js';

/**
 * The two records side by side, and, once nothing is left to choose and nothing refuses the pair,
 * exactly what the merge would write. Writes nothing.
 */
export const POST = treeHandler(
	{ failure: 'Failed to review the merge', params: ['personId'], body: personMergeSchema },
	async ({ db, ctx, treeId, params, body }) => {
		const service = new PersonMergeService(db);
		const request = { survivorId: params.personId, ...body };
		const review = await service.review(treeId, request, ctx);
		const isPlannable = review.refusal === null && review.conflicts.length === 0;
		return { review, impact: isPlannable ? await service.preview(treeId, request, ctx) : null };
	}
);
