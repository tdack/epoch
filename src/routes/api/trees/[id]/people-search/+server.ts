import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { RelationshipService } from '#lib/server/services/relationship-service.js';
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

	const query = url.searchParams.get('q') ?? '';

	try {
		const db = getDb(platform.env.DB);
		const service = new RelationshipService(db);

		const people = await service.searchPeople(treeId, query, {
			user: locals.user,
			correlationId: locals.correlationId
		});

		return Response.json({ people });
	} catch (err) {
		return errorResponse(err, 'Failed to search people');
	}
};
