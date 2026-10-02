import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { PersonPageService } from '#lib/server/services/person-page-service.js';
import { errorResponse } from '#lib/server/http/error-response.js';

/** Everything the person page shows, from bounded reads: see `PersonPageDto`. */
export const GET: RequestHandler = async ({ params, locals, platform }) => {
	if (!locals.user) return Response.json({ error: 'Authentication required' }, { status: 401 });
	const { id: treeId, personId } = params;
	if (!treeId || !personId)
		return Response.json({ error: 'Tree ID and person ID required' }, { status: 400 });
	if (!platform?.env?.DB)
		return Response.json({ error: 'Database binding unavailable' }, { status: 500 });

	try {
		const service = new PersonPageService(getDb(platform.env.DB));
		return Response.json(
			await service.getPerson(treeId, personId, {
				user: locals.user,
				correlationId: locals.correlationId
			})
		);
	} catch (err) {
		return errorResponse(err, 'Failed to load the person');
	}
};
