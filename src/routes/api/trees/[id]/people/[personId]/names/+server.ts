import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { NameService } from '#lib/server/services/name-service.js';
import { errorResponse } from '#lib/server/http/error-response.js';
import { parseBody } from '#lib/server/validation/index.js';
import { nameCreateSchema } from '#lib/server/validation/schemas.js';

/** Add a name to a person. */
export const POST: RequestHandler = async ({ params, request, locals, platform }) => {
	if (!locals.user) return Response.json({ error: 'Authentication required' }, { status: 401 });
	const { id: treeId, personId } = params;
	if (!treeId || !personId)
		return Response.json({ error: 'Tree ID and person ID required' }, { status: 400 });
	if (!platform?.env?.DB)
		return Response.json({ error: 'Database binding unavailable' }, { status: 500 });

	try {
		const { isPreferred, ...name } = parseBody(
			nameCreateSchema,
			await request.json().catch(() => ({}))
		);
		const service = new NameService(getDb(platform.env.DB));
		const { nameId, change } = await service.create(treeId, personId, name as never, isPreferred, {
			user: locals.user,
			correlationId: locals.correlationId
		});
		return Response.json({ nameId, change }, { status: 201 });
	} catch (err) {
		return errorResponse(err, 'Failed to add the name');
	}
};
