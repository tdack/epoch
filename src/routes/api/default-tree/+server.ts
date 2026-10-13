import { apiHandler } from '#lib/server/http/handler.js';
import { TreeService } from '#lib/server/services/tree-service.js';
import { defaultTreeSchema } from '#lib/server/validation/schemas.js';

/** The tree `/` opens for the signed-in user (`null` clears it). */
export const PUT = apiHandler(
	{ failure: 'Failed to save the default tree', body: defaultTreeSchema },
	({ db, ctx, body }) => new TreeService(db).setDefaultTree(body.treeId, ctx)
);
