import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { MarkService } from '#lib/server/services/mark-service.js';
import { errorResponse } from '#lib/server/http/error-response.js';

/** The signed-in user's favourites and recents in this tree. See `MarksDto`. */
export const GET: RequestHandler = async ({ params, locals, platform }) => {
	if (!locals.user) return Response.json({ error: 'Authentication required' }, { status: 401 });
	const { id: treeId } = params;
	if (!treeId) return Response.json({ error: 'Tree ID required' }, { status: 400 });
	if (!platform?.env?.DB)
		return Response.json({ error: 'Database binding unavailable' }, { status: 500 });
	try {
		return Response.json(
			await new MarkService(getDb(platform.env.DB)).get(treeId, {
				user: locals.user,
				correlationId: locals.correlationId
			})
		);
	} catch (err) {
		return errorResponse(err, 'Failed to load favourites and recents');
	}
};
