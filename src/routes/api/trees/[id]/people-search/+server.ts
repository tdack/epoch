import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { SearchService } from '#lib/server/services/search-service.js';
import { parseSearchParams } from '#lib/shared/search.js';
import { errorResponse } from '#lib/server/http/error-response.js';

export const GET: RequestHandler = async ({ params, url, locals, platform }) => {
	if (!locals.user) {
		return Response.json({ error: 'Authentication required' }, { status: 401 });
	}

	const { id: treeId } = params;
	if (!treeId) {
		return Response.json({ error: 'Tree ID required' }, { status: 400 });
	}

	if (!platform?.env?.DB) {
		return Response.json({ error: 'Database binding unavailable' }, { status: 500 });
	}

	try {
		const db = getDb(platform.env.DB);
		// The focus box and relationship dialog ask for names only, so place and dates are not read.
		const { text, limit } = parseSearchParams(url.searchParams);
		const { people } = await new SearchService(db).search(treeId, { text, limit }, { user: locals.user, correlationId: locals.correlationId });
		return Response.json({ people });
	} catch (err) {
		return errorResponse(err, 'Failed to search people');
	}
};
