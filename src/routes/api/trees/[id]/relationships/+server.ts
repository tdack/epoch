import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { RelationshipService } from '#lib/server/services/relationship-service.js';
import { errorResponse } from '#lib/server/http/error-response.js';
import { relationshipPayloadSchema } from '#lib/server/validation/schemas.js';
import { parseBody } from '#lib/server/validation/index.js';

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
		const { intent } = parseBody(relationshipPayloadSchema, await request.json().catch(() => ({})));
		const db = getDb(platform.env.DB);
		const service = new RelationshipService(db);

		const { change, affected, ...plan } = await service.execute(treeId, intent, {
			user: locals.user,
			correlationId: locals.correlationId
		});

		// 200 rather than 201 when the plan wrote nothing (a warning stopped it), so the client can say so.
		return Response.json({ success: true, plan, change, affected }, { status: change ? 201 : 200 });
	} catch (err) {
		return errorResponse(err, 'Failed to apply relationship command');
	}
};
