import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { MarkService } from '#lib/server/services/mark-service.js';
import { errorResponse } from '#lib/server/http/error-response.js';

/**
 * Record that the user opened a person. A POST from the page, never a side effect of a GET or a
 * load: SvelteKit preloads links on hover, and a preload must not log people nobody opened.
 * Idempotent: a repeat moves the person to the front. Answers with the marks, so the page updates in place.
 */
export const POST: RequestHandler = async ({ params, request, locals, platform }) => {
	if (!locals.user) return Response.json({ error: 'Authentication required' }, { status: 401 });
	const { id: treeId } = params;
	if (!treeId) return Response.json({ error: 'Tree ID required' }, { status: 400 });
	if (!platform?.env?.DB)
		return Response.json({ error: 'Database binding unavailable' }, { status: 500 });
	try {
		const body = (await request.json().catch(() => null)) as { personId?: unknown } | null;
		if (typeof body?.personId !== 'string' || !body.personId)
			return Response.json({ error: 'personId required' }, { status: 400 });
		const service = new MarkService(getDb(platform.env.DB));
		const context = { user: locals.user, correlationId: locals.correlationId };
		await service.recordRecent(treeId, body.personId, context);
		return Response.json(await service.get(treeId, context));
	} catch (err) {
		return errorResponse(err, 'Failed to record the recent person');
	}
};
