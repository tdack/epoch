import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { PlaceService } from '#lib/server/services/place-service.js';
import { errorResponse } from '#lib/server/http/error-response.js';
import { placeRewriteSchema } from '#lib/server/validation/schemas.js';
import { parseBody } from '#lib/server/validation/index.js';

/** Preview renaming or merging a place: the facts that would change. Saves nothing. */
export const POST: RequestHandler = async ({ params, request, locals, platform }) => {
	if (!locals.user) return Response.json({ error: 'Authentication required' }, { status: 401 });
	const { id: treeId, placeId } = params;
	if (!treeId || !placeId)
		return Response.json({ error: 'Tree ID and place ID required' }, { status: 400 });
	if (!platform?.env?.DB)
		return Response.json({ error: 'Database binding unavailable' }, { status: 500 });

	try {
		const { name } = parseBody(placeRewriteSchema, await request.json().catch(() => ({})));
		const service = new PlaceService(getDb(platform.env.DB));
		return Response.json({
			impact: await service.previewRewrite(treeId, placeId, name, {
				user: locals.user,
				correlationId: locals.correlationId
			})
		});
	} catch (err) {
		return errorResponse(err, 'Failed to preview the place change');
	}
};
