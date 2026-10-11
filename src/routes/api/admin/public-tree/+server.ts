import { apiHandler } from '#lib/server/http/handler.js';
import { PublicTreeService } from '#lib/server/services/public-tree-service.js';
import { publicTreeSchema } from '#lib/server/validation/schemas.js';

/** Make a tree public, replace the public tree, or (`treeId: null`) make it private. */
export const PUT = apiHandler(
	{ failure: 'Failed to change the public tree', body: publicTreeSchema },
	async ({ db, ctx, body }) =>
		new PublicTreeService(db).setPublicTree(body.treeId, body.confirmName, ctx)
);
