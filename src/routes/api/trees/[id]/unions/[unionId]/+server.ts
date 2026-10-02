import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { RelationshipService } from '#lib/server/services/relationship-service.js';
import { UnionPageService } from '#lib/server/services/union-page-service.js';
import { errorResponse } from '#lib/server/http/error-response.js';
import { unionUpdateSchema } from '#lib/server/validation/schemas.js';
import { parseBody } from '#lib/server/validation/index.js';

/** Edit a partnership's status and events (marriage, engagement, separation, divorce, annulment). */
export const PUT: RequestHandler = async ({ params, request, locals, platform }) => {
	if (!locals.user) {
		return Response.json({ error: 'Authentication required' }, { status: 401 });
	}

	const { id: treeId, unionId } = params;
	if (!treeId || !unionId) {
		return Response.json({ error: 'Tree ID and Union ID required' }, { status: 400 });
	}

	if (!platform?.env?.DB) {
		return Response.json({ error: 'Database binding unavailable' }, { status: 500 });
	}

	try {
		const { version, status, events } = parseBody(
			unionUpdateSchema,
			await request.json().catch(() => ({}))
		);
		const service = new RelationshipService(getDb(platform.env.DB));

		const { change } = await service.updateUnion(
			treeId,
			{ kind: 'update_union', unionId, expectedVersion: version, status, events },
			{ user: locals.user, correlationId: locals.correlationId }
		);

		return Response.json({ success: true, change });
	} catch (err) {
		return errorResponse(err, 'Failed to update union');
	}
};

/** Everything the partnership page shows, from bounded reads: see `UnionPageDto`. */
export const GET: RequestHandler = async ({ params, locals, platform }) => {
	if (!locals.user) return Response.json({ error: 'Authentication required' }, { status: 401 });
	const { id: treeId, unionId } = params;
	if (!treeId || !unionId)
		return Response.json({ error: 'Tree ID and Union ID required' }, { status: 400 });
	if (!platform?.env?.DB)
		return Response.json({ error: 'Database binding unavailable' }, { status: 500 });

	try {
		const service = new UnionPageService(getDb(platform.env.DB));
		return Response.json(
			await service.getUnion(treeId, unionId, {
				user: locals.user,
				correlationId: locals.correlationId
			})
		);
	} catch (err) {
		return errorResponse(err, 'Failed to load the partnership');
	}
};
