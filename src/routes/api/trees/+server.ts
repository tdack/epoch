import { apiHandler } from '#lib/server/http/handler.js';
import { GenealogyService } from '#lib/server/services/genealogy-service.js';
import { treeCreateSchema } from '#lib/server/validation/schemas.js';

export const GET = apiHandler({ failure: 'Failed to fetch trees' }, async ({ db, ctx }) => ({
	trees: await new GenealogyService(db).listTrees(ctx)
}));

export const POST = apiHandler(
	{ failure: 'Failed to create tree', body: treeCreateSchema, status: 201 },
	async ({ db, ctx, body: { name, description } }) => ({
		tree: await new GenealogyService(db).createTree(name, description ?? null, ctx)
	})
);
