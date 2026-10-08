import { treeHandler } from '#lib/server/http/handler.js';
import { TreeService } from '#lib/server/services/tree-service.js';
import { treeRenameSchema } from '#lib/server/validation/schemas.js';

/** Rename the tree; a stale `version` answers 409 with nothing changed. */
export const PATCH = treeHandler(
	{ failure: 'Failed to rename tree', body: treeRenameSchema },
	async ({ db, ctx, treeId, body }) => ({
		tree: await new TreeService(db).updateTree(treeId, body.version, { name: body.name }, ctx)
	})
);

export const DELETE = treeHandler(
	{ failure: 'Failed to delete tree' },
	async ({ db, ctx, treeId }) => {
		await new TreeService(db).deleteTree(treeId, ctx);
		return { success: true };
	}
);
