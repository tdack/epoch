import { treeHandler } from '#lib/server/http/handler.js';
import { SubtreeService } from '#lib/server/services/subtree-service.js';
import { subtreeCreateSchema } from '#lib/server/validation/schemas.js';

/** The sub-trees the viewer may open, in `position` order: those whose root person they may see. */
export const GET = treeHandler(
	{ failure: 'Failed to list the sub-trees' },
	async ({ db, ctx, treeId }) => ({ subtrees: await new SubtreeService(db).list(treeId, ctx) })
);

/** Make a sub-tree rooted at a person: a manager or above. */
export const POST = treeHandler(
	{ failure: 'Failed to add the sub-tree', body: subtreeCreateSchema, status: 201 },
	async ({ db, ctx, treeId, body }) => {
		const service = new SubtreeService(db);
		const { subtreeId, change } = await service.create(treeId, body, ctx);
		return { subtree: await service.get(treeId, subtreeId, ctx), change };
	}
);
