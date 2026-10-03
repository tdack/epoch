import { treeHandler } from '#lib/server/http/handler.js';
import { PersonMergeService } from '#lib/server/services/person-merge-service.js';
import { personMergeSchema } from '#lib/server/validation/schemas.js';

/** Fold another record of the same person into this one, as one change with one undo. */
export const POST = treeHandler(
	{ failure: 'Failed to merge the people', params: ['personId'], body: personMergeSchema },
	async ({ db, ctx, treeId, params, body }) => {
		const { change } = await new PersonMergeService(db).merge(
			treeId,
			{ survivorId: params.personId, ...body },
			ctx
		);
		return { change };
	}
);
