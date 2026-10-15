import type { CreateTreeResponse, TreeListResponse } from '#lib/shared/api-contracts.js';
import { apiHandler } from '#lib/server/http/handler.js';
import { TreeService } from '#lib/server/services/tree-service.js';
import { treeCreateSchema } from '#lib/server/validation/schemas.js';

export const GET = apiHandler(
	{ allowPublicVisitor: true, failure: 'Failed to fetch trees' },
	async ({ db, ctx }): Promise<TreeListResponse> => ({
		trees: await new TreeService(db).listTrees(ctx)
	})
);

export const POST = apiHandler(
	{ failure: 'Failed to create tree', body: treeCreateSchema, status: 201 },
	async ({ db, ctx, body: { name, description } }): Promise<CreateTreeResponse> => ({
		tree: await new TreeService(db).createTree(name, description ?? null, ctx)
	})
);
