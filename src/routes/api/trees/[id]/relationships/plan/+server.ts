import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { RelationshipService } from '#lib/server/services/relationship-service.js';
import { DomainError } from '#lib/server/domain/errors.js';
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

		const plan = await service.plan(treeId, intent, {
			user: locals.user,
			correlationId: locals.correlationId
		});

		return Response.json({ plan });
	} catch (err: any) {
		if (err instanceof DomainError) {
			return Response.json({ error: err.message, code: err.code, details: err.details }, { status: err.status });
		}
		console.error('Failed to plan relationship command:', err);
		return Response.json({ error: err?.message || 'Failed to plan relationship command' }, { status: 500 });
	}
};
