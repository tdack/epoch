import { treeHandler } from '#lib/server/http/handler.js';
import { TreeService } from '#lib/server/services/tree-service.js';

export const DELETE = treeHandler(
	{ failure: 'Failed to delete tree' },
	async ({ db, ctx, treeId }) => {
		await new TreeService(db).deleteTree(treeId, ctx);
		return { success: true };
	}
);
