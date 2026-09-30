import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { GraphQueryService } from '#lib/server/services/graph-query-service.js';
import { errorResponse } from '#lib/server/http/error-response.js';

/** The tree's name, counts and default focus: what a page needs before it has a person to draw. */
export const GET: RequestHandler = async ({ params, locals, platform }) => {
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
		const service = new GraphQueryService(getDb(platform.env.DB));
		return Response.json(await service.summary(treeId, { user: locals.user, correlationId: locals.correlationId }));
	} catch (err) {
		return errorResponse(err, 'Failed to load the tree summary');
	}
};
