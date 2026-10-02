import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { FactService } from '#lib/server/services/fact-service.js';
import { errorResponse } from '#lib/server/http/error-response.js';
import { factReorderSchema } from '#lib/server/validation/schemas.js';
import { parseBody } from '#lib/server/validation/index.js';

export const POST: RequestHandler = async ({ params, request, locals, platform }) => {
	if (!locals.user) return Response.json({ error: 'Authentication required' }, { status: 401 });
	const { id: treeId, personId } = params;
	if (!treeId || !personId)
		return Response.json({ error: 'Tree ID and person ID required' }, { status: 400 });
	if (!platform?.env?.DB)
		return Response.json({ error: 'Database binding unavailable' }, { status: 500 });

	try {
		const { orderedFactIds } = parseBody(factReorderSchema, await request.json().catch(() => ({})));
		const service = new FactService(getDb(platform.env.DB));
		const { change } = await service.reorder(treeId, personId, orderedFactIds, {
			user: locals.user,
			correlationId: locals.correlationId
		});
		return Response.json({ change });
	} catch (err) {
		return errorResponse(err, 'Failed to reorder the facts');
	}
};
