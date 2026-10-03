import { treeHandler } from '#lib/server/http/handler.js';
import { PlaceService } from '#lib/server/services/place-service.js';
import { placeRewriteSchema } from '#lib/server/validation/schemas.js';

/** Preview renaming or merging a place: the facts that would change. Saves nothing. */
export const POST = treeHandler(
	{ failure: 'Failed to preview the place change', params: ['placeId'], body: placeRewriteSchema },
	async ({ db, ctx, treeId, params, body: { name } }) => ({
		impact: await new PlaceService(db).previewRewrite(treeId, params.placeId, name, ctx)
	})
);
