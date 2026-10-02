import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { KinshipService } from '#lib/server/services/kinship-service.js';
import { errorResponse } from '#lib/server/http/error-response.js';

/** `?from=<person>&to=<person>`: every way the second is related to the first (see `RelationshipDto`). */
export const GET: RequestHandler = async ({ params, url, locals, platform }) => {
	if (!locals.user) return Response.json({ error: 'Authentication required' }, { status: 401 });
	const treeId = params.id;
	if (!treeId) return Response.json({ error: 'Tree ID required' }, { status: 400 });
	if (!platform?.env?.DB) return Response.json({ error: 'Database binding unavailable' }, { status: 500 });
	const from = url.searchParams.get('from');
	const to = url.searchParams.get('to');
	if (!from || !to) return Response.json({ error: 'Both from and to are required' }, { status: 400 });

	try {
		return Response.json(await new KinshipService(getDb(platform.env.DB)).relationship(treeId, from, to, { user: locals.user, correlationId: locals.correlationId }));
	} catch (err) {
		return errorResponse(err, 'Failed to work out the relationship');
	}
};
