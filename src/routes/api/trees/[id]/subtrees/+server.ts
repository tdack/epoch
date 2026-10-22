import { treeHandler } from '#lib/server/http/handler.js';
import { SubtreeService } from '#lib/server/services/subtree-service.js';
import { subtreeCreateSchema, subtreeReorderSchema } from '#lib/server/validation/schemas.js';

/** Make a sub-tree rooted at a person: a manager or above. */
export const POST = treeHandler(
	{ failure: 'Failed to add the sub-tree', body: subtreeCreateSchema, status: 201 },
	async ({ db, ctx, treeId, body }) => {
		const service = new SubtreeService(db);
		const { subtreeId, change } = await service.create(treeId, body, ctx);
		return { subtree: await service.get(treeId, subtreeId, ctx), change };
	}
);

/** Put the sub-trees in a new order, as one change: a manager or above. */
export const PUT = treeHandler(
	{ failure: 'Failed to save the sub-tree order', body: subtreeReorderSchema },
	async ({ db, ctx, treeId, body }) => {
		const { change } = await new SubtreeService(db).reorder(treeId, body.order, ctx);
		return { change };
	}
);
