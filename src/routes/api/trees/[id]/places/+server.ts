import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { PlaceService } from '#lib/server/services/place-service.js';
import { errorResponse } from '#lib/server/http/error-response.js';
import { parseListParams } from '#lib/shared/lists.js';

/**
 * Places the tree's facts name, a page at a time: `?q=&offset=&limit=`, where `q` finds places
 * whose text contains it (the fact editor uses it for suggestions). `?name=` answers one place's
 * facts instead.
 */
export const GET: RequestHandler = async ({ params, url, locals, platform }) => {
	if (!locals.user) return Response.json({ error: 'Authentication required' }, { status: 401 });
	const { id: treeId } = params;
	if (!treeId) return Response.json({ error: 'Tree ID required' }, { status: 400 });
	if (!platform?.env?.DB)
		return Response.json({ error: 'Database binding unavailable' }, { status: 500 });

	try {
		const service = new PlaceService(getDb(platform.env.DB));
		const context = { user: locals.user, correlationId: locals.correlationId };
		const page = parseListParams(url.searchParams);
		const name = url.searchParams.get('name');
		if (name) return Response.json(await service.detail(treeId, name, page, context));
		return Response.json(
			await service.list(treeId, { q: url.searchParams.get('q') ?? '', ...page }, context)
		);
	} catch (err) {
		return errorResponse(err, 'Failed to list places');
	}
};
