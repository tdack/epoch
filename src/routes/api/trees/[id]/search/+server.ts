import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { SearchService } from '#lib/server/services/search-service.js';
import { errorResponse } from '#lib/server/http/error-response.js';
import { parseSearchParams } from '#lib/shared/search.js';

/** Ranked people for `?q=&place=&from=&to=&limit=&offset=`; each says what matched. See `SearchResponse`. */
export const GET: RequestHandler = async ({ params, url, locals, platform }) => {
	if (!locals.user) return Response.json({ error: 'Authentication required' }, { status: 401 });
	const { id: treeId } = params;
	if (!treeId) return Response.json({ error: 'Tree ID required' }, { status: 400 });
	if (!platform?.env?.DB) return Response.json({ error: 'Database binding unavailable' }, { status: 500 });

	try {
		const service = new SearchService(getDb(platform.env.DB));
		return Response.json(await service.search(treeId, parseSearchParams(url.searchParams), { user: locals.user, correlationId: locals.correlationId }));
	} catch (err) {
		return errorResponse(err, 'Failed to search the tree');
	}
};
