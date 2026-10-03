import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { GraphQueryService } from '#lib/server/services/graph-query-service.js';
import { ValidationError } from '#lib/server/domain/errors.js';
import { errorResponse } from '#lib/server/http/error-response.js';
import { parseFocusQuery } from '#lib/server/validation/graph-query.js';

/**
 * `?focus=<person>` answers the bounded graph the focus view draws (see `FocusGraphDto`); `up`,
 * `down`, `siblings`, `step` and `exp` shape it as they shape the page.
 */
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
		const context = { user: locals.user, correlationId: locals.correlationId };
		const { focusPersonId, options } = parseFocusQuery(url.searchParams);

		if (!focusPersonId) throw new ValidationError('focus: a person to centre the graph on');
		return Response.json(
			await new GraphQueryService(db).focusGraph(treeId, focusPersonId, options, context)
		);
	} catch (err) {
		return errorResponse(err, 'Failed to load relationship graph');
	}
};
