import { treeHandler } from '#lib/server/http/handler.js';
import { RelationshipService } from '#lib/server/services/relationship-service.js';
import { unionMergeSchema } from '#lib/server/validation/schemas.js';

/**
 * Merge partnerships between the same people into one. With `isPreview` it writes nothing and
 * returns every conflict plus, once none is open, the exact records the merge would change.
 * Without it, an open conflict is a 409 and nothing is written.
 */
export const POST = treeHandler(
	{ failure: 'Failed to merge partnerships', body: unionMergeSchema },
	async ({ db, ctx, treeId, body: { isPreview, ...body } }) => {
		const service = new RelationshipService(db);
		const command = { kind: 'merge_unions' as const, ...body };
		if (isPreview) return service.previewMerge(treeId, command, ctx);
		const { change } = await service.mergeUnions(treeId, command, ctx);
		return { change };
	}
);
