import { treeHandler } from '#lib/server/http/handler.js';
import { GenealogyService } from '#lib/server/services/genealogy-service.js';

export const DELETE = treeHandler(
	{ failure: 'Failed to delete tree' },
	async ({ db, ctx, treeId }) => {
		await new GenealogyService(db).deleteTree(treeId, ctx);
		return { success: true };
	}
);
