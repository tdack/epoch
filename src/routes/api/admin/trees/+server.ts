import type { InstallTreesResponse } from '#lib/shared/api-contracts.js';
import { apiHandler } from '#lib/server/http/handler.js';
import { PublicTreeService } from '#lib/server/services/public-tree-service.js';

/** Every tree in the install, for its owner's Trees page. */
export const GET = apiHandler(
	{ failure: 'Failed to list trees' },
	async ({ db, ctx }): Promise<InstallTreesResponse> => ({
		trees: await new PublicTreeService(db).listAll(ctx)
	})
);
