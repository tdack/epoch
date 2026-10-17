import type { RenameTreeResponse } from '#lib/shared/api-contracts.js';
import { treeHandler } from '#lib/server/http/handler.js';
import { TreeService } from '#lib/server/services/tree-service.js';
import { treeRenameSchema } from '#lib/server/validation/schemas.js';
import { treeHostConfig } from '#lib/server/http/tree-host.js';

/**
 * Rename the tree, change its address or turn its subdomain on or off; a stale `version` answers
 * 409 with nothing changed.
 */
export const PATCH = treeHandler(
	{ failure: 'Failed to rename tree', body: treeRenameSchema },
	async ({ db, ctx, treeId, body, event }): Promise<RenameTreeResponse> => {
		const tree = await new TreeService(db).updateTree(
			treeId,
			body.version,
			{
				name: body.name,
				...(body.slug !== undefined && { slug: body.slug }),
				...(body.isOnSubdomain !== undefined && { isOnSubdomain: body.isOnSubdomain })
			},
			ctx,
			treeHostConfig(event.platform?.env)
		);
		return { tree: { id: tree.id, slug: tree.slug, isOnSubdomain: tree.isOnSubdomain === true } };
	}
);

/**
 * Deletes the tree and then its stored files. The bucket is checked first: without it the rows
 * would go and the files would be left behind with nothing to sweep them.
 */
export const DELETE = treeHandler(
	{ failure: 'Failed to delete tree' },
	async ({ db, ctx, treeId, event }) => {
		const bucket = event.platform?.env?.MEDIA_BUCKET;
		if (!bucket) return Response.json({ error: 'R2 binding unavailable' }, { status: 500 });
		await new TreeService(db).deleteTree(treeId, ctx, bucket);
		return {};
	}
);
