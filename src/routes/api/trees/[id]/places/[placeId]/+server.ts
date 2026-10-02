import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { PlaceService } from '#lib/server/services/place-service.js';
import { errorResponse } from '#lib/server/http/error-response.js';
import { placeRewriteSchema } from '#lib/server/validation/schemas.js';
import { parseBody } from '#lib/server/validation/index.js';

/** Rename a place, or merge it into the place that already has the name. One change, one undo. */
export const PUT: RequestHandler = async ({ params, request, locals, platform }) => {
	if (!locals.user) return Response.json({ error: 'Authentication required' }, { status: 401 });
	const { id: treeId, placeId } = params;
	if (!treeId || !placeId) return Response.json({ error: 'Tree ID and place ID required' }, { status: 400 });
	if (!platform?.env?.DB) return Response.json({ error: 'Database binding unavailable' }, { status: 500 });

	try {
		const { name } = parseBody(placeRewriteSchema, await request.json().catch(() => ({})));
		const service = new PlaceService(getDb(platform.env.DB));
		const { change, name: saved } = await service.rewrite(treeId, placeId, name, { user: locals.user, correlationId: locals.correlationId });
		return Response.json({ change, name: saved });
	} catch (err) {
		return errorResponse(err, 'Failed to change the place');
	}
};
