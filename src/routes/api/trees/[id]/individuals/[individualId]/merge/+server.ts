import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { PersonMergeService } from '#lib/server/services/person-merge-service.js';
import { errorResponse } from '#lib/server/http/error-response.js';
import { personMergeSchema } from '#lib/server/validation/schemas.js';
import { parseBody } from '#lib/server/validation/index.js';

/** Fold another record of the same person into this one, as one change with one undo. */
export const POST: RequestHandler = async ({ params, request, locals, platform }) => {
	if (!locals.user) return Response.json({ error: 'Authentication required' }, { status: 401 });
	const { id: treeId, individualId } = params;
	if (!treeId || !individualId)
		return Response.json({ error: 'Tree ID and person ID required' }, { status: 400 });
	if (!platform?.env?.DB)
		return Response.json({ error: 'Database binding unavailable' }, { status: 500 });

	try {
		const body = parseBody(personMergeSchema, await request.json().catch(() => ({})));
		const service = new PersonMergeService(getDb(platform.env.DB));
		const { change } = await service.merge(
			treeId,
			{ survivorId: individualId, ...body },
			{ user: locals.user, correlationId: locals.correlationId }
		);
		return Response.json({ change });
	} catch (err) {
		return errorResponse(err, 'Failed to merge the people');
	}
};
