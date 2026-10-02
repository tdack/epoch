import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { FactService } from '#lib/server/services/fact-service.js';
import { errorResponse } from '#lib/server/http/error-response.js';
import { factCreateSchema } from '#lib/server/validation/schemas.js';
import { parseBody } from '#lib/server/validation/index.js';

/** Add a fact to a person. Repeated and conflicting facts are welcome: nothing is matched by type. */
export const POST: RequestHandler = async ({ params, request, locals, platform }) => {
	if (!locals.user) return Response.json({ error: 'Authentication required' }, { status: 401 });
	const { id: treeId, personId } = params;
	if (!treeId || !personId)
		return Response.json({ error: 'Tree ID and person ID required' }, { status: 400 });
	if (!platform?.env?.DB)
		return Response.json({ error: 'Database binding unavailable' }, { status: 500 });

	try {
		const fact = parseBody(factCreateSchema, await request.json().catch(() => ({})));
		const service = new FactService(getDb(platform.env.DB));
		const { factId, change } = await service.create(treeId, personId, fact, {
			user: locals.user,
			correlationId: locals.correlationId
		});
		return Response.json({ factId, change }, { status: 201 });
	} catch (err) {
		return errorResponse(err, 'Failed to add the fact');
	}
};
