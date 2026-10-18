import { expectedVersion, treeHandler } from '#lib/server/http/handler.js';
import { SubtreeService } from '#lib/server/services/subtree-service.js';
import { subtreeUpdateSchema } from '#lib/server/validation/schemas.js';

/** Edit a sub-tree's name, address, root or place in the list: a manager or above. */
export const PATCH = treeHandler(
	{ failure: 'Failed to save the sub-tree', params: ['subtreeId'], body: subtreeUpdateSchema },
	async ({ db, ctx, treeId, params, body }) => {
		const service = new SubtreeService(db);
		const { change } = await service.update(treeId, params.subtreeId, body, ctx);
		return { subtree: await service.get(treeId, params.subtreeId, ctx), change };
	}
);

/** Delete a sub-tree: a manager or above. The change is logged, so it can be undone. */
export const DELETE = treeHandler(
	{ failure: 'Failed to delete the sub-tree', params: ['subtreeId'] },
	async ({ db, ctx, treeId, params, url }) => {
		const { change } = await new SubtreeService(db).delete(
			treeId,
			params.subtreeId,
			expectedVersion(url),
			ctx
		);
		return { change };
	}
);
