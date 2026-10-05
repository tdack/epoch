import { treeHandler } from '#lib/server/http/handler.js';
import { TreeService } from '#lib/server/services/tree-service.js';
import { viewModeSchema } from '#lib/server/validation/schemas.js';

/** The view members with no choice of their own get, set by the owner (`null` clears it). */
export const PUT = treeHandler(
	{ failure: 'Failed to save the default view', body: viewModeSchema },
	({ db, ctx, treeId, body }) => new TreeService(db).setDefaultViewMode(treeId, body.mode, ctx)
);
