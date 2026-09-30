import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { ListService } from '#lib/server/services/list-service.js';
import { errorResponse } from '#lib/server/http/error-response.js';
import { parseListParams, INDIVIDUAL_SORTS } from '#lib/shared/lists.js';

/** One page of people: `?sort=surname|given&surname=&offset=&limit=`. */
export const GET: RequestHandler = async ({ params, url, locals, platform }) => {
	if (!locals.user) return Response.json({ error: 'Authentication required' }, { status: 401 });
	const { id: treeId } = params;
	if (!treeId) return Response.json({ error: 'Tree ID required' }, { status: 400 });
	if (!platform?.env?.DB) return Response.json({ error: 'Database binding unavailable' }, { status: 500 });

	try {
		const service = new ListService(getDb(platform.env.DB));
		const context = { user: locals.user, correlationId: locals.correlationId };
		return Response.json(await service.individuals(treeId, { ...parseListParams(url.searchParams), sort: url.searchParams.get('sort') === INDIVIDUAL_SORTS.GIVEN ? INDIVIDUAL_SORTS.GIVEN : INDIVIDUAL_SORTS.SURNAME, surname: url.searchParams.get('surname') ?? '' }, context));
	} catch (err) {
		return errorResponse(err, 'Failed to list people');
	}
};
