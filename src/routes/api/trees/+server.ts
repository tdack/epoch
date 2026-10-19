import type { CreateTreeResponse } from '#lib/shared/api-contracts.js';
import { apiHandler } from '#lib/server/http/handler.js';
import { TreeService } from '#lib/server/services/tree-service.js';
import { treeCreateSchema } from '#lib/server/validation/schemas.js';

export const POST = apiHandler(
	{ failure: 'Failed to create tree', body: treeCreateSchema, status: 201 },
	async ({ db, ctx, body: { name, description } }): Promise<CreateTreeResponse> => ({
		tree: await new TreeService(db).createTree(name, description ?? null, ctx)
	})
);
