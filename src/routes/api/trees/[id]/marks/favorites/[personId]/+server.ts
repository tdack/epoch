import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { MarkService } from '#lib/server/services/mark-service.js';
import { errorResponse } from '#lib/server/http/error-response.js';

async function run(action: 'add' | 'remove', { params, locals, platform }: Parameters<RequestHandler>[0]): Promise<Response> {
	if (!locals.user) return Response.json({ error: 'Authentication required' }, { status: 401 });
	const { id: treeId, personId } = params;
	if (!treeId || !personId) return Response.json({ error: 'Tree ID and person ID required' }, { status: 400 });
	if (!platform?.env?.DB) return Response.json({ error: 'Database binding unavailable' }, { status: 500 });
	try {
		const service = new MarkService(getDb(platform.env.DB));
		const context = { user: locals.user, correlationId: locals.correlationId };
		if (action === 'add') await service.addFavorite(treeId, personId, context);
		else await service.removeFavorite(treeId, personId, context);
		return Response.json(await service.get(treeId, context));
	} catch (err) {
		return errorResponse(err, 'Failed to change the favourite');
	}
}

/** Favourite a person. Idempotent. */
export const PUT: RequestHandler = (event) => run('add', event);

/** Remove a favourite. Idempotent: removing one that is not there is fine. */
export const DELETE: RequestHandler = (event) => run('remove', event);
