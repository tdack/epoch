import { apiHandler } from '#lib/server/http/handler.js';
import { PublicTreeService } from '#lib/server/services/public-tree-service.js';
import { treeOrderSchema } from '#lib/server/validation/schemas.js';

/** Set the order trees are listed in, for every member (install owner only). */
export const PUT = apiHandler(
	{ failure: 'Failed to save the tree order', body: treeOrderSchema },
	async ({ db, ctx, body }) => {
		await new PublicTreeService(db).reorder(body.order, ctx);
		return { ok: true };
	}
);
