import { treeHandler } from '#lib/server/http/handler.js';
import { PlaceService } from '#lib/server/services/place-service.js';
import { placeRewriteSchema } from '#lib/server/validation/schemas.js';

/** Rename a place, or merge it into the place that already has the name. One change, one undo. */
export const PUT = treeHandler(
	{ failure: 'Failed to change the place', params: ['placeId'], body: placeRewriteSchema },
	async ({ db, ctx, treeId, params, body: { name } }) => {
		const { change, name: saved } = await new PlaceService(db).rewrite(
			treeId,
			params.placeId,
			name,
			ctx
		);
		return { change, name: saved };
	}
);
