import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { ListService } from '#lib/server/services/list-service.js';
import { errorResponse } from '#lib/server/http/error-response.js';
import { parseListParams } from '#lib/shared/lists.js';

/** One page of surnames with counts: `?offset=&limit=`. */
export const GET: RequestHandler = async ({ params, url, locals, platform }) => {
	if (!locals.user) return Response.json({ error: 'Authentication required' }, { status: 401 });
	const { id: treeId } = params;
	if (!treeId) return Response.json({ error: 'Tree ID required' }, { status: 400 });
	if (!platform?.env?.DB)
		return Response.json({ error: 'Database binding unavailable' }, { status: 500 });

	try {
		const service = new ListService(getDb(platform.env.DB));
		const context = { user: locals.user, correlationId: locals.correlationId };
		return Response.json(
			await service.surnames(treeId, parseListParams(url.searchParams), context)
		);
	} catch (err) {
		return errorResponse(err, 'Failed to list surnames');
	}
};
