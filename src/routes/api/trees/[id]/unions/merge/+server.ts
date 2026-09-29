import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { RelationshipService } from '#lib/server/services/relationship-service.js';
import { errorResponse } from '#lib/server/http/error-response.js';
import { unionMergeSchema } from '#lib/server/validation/schemas.js';
import { parseBody } from '#lib/server/validation/index.js';

/**
 * Merge partnerships between the same people into one. With `isPreview` it writes nothing and
 * returns every conflict plus, once none is open, the exact records the merge would change.
 * Without it, an open conflict is a 409 and nothing is written.
 */
export const POST: RequestHandler = async ({ params, request, locals, platform }) => {
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
		const { isPreview, ...body } = parseBody(unionMergeSchema, await request.json().catch(() => ({})));
		const service = new RelationshipService(getDb(platform.env.DB));
		const context = { user: locals.user, correlationId: locals.correlationId };
		const command = { kind: 'merge_unions' as const, ...body };

		if (isPreview) return Response.json(await service.previewMerge(treeId, command, context));

		const { change } = await service.mergeUnions(treeId, command, context);
		return Response.json({ success: true, change });
	} catch (err) {
		return errorResponse(err, 'Failed to merge partnerships');
	}
};
