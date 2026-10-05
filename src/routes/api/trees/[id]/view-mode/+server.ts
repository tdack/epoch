import { treeHandler } from '#lib/server/http/handler.js';
import { TreeService } from '#lib/server/services/tree-service.js';
import { viewModeSchema } from '#lib/server/validation/schemas.js';

/** The signed-in member's own choice of view in this tree (`null` clears it). */
export const PUT = treeHandler(
	{ failure: 'Failed to save the view', body: viewModeSchema },
	({ db, ctx, treeId, body }) => new TreeService(db).setViewMode(treeId, body.mode, ctx)
);
