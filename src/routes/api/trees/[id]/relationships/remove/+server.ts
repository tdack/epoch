import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { RelationshipService } from '#lib/server/services/relationship-service.js';
import { errorResponse } from '#lib/server/http/error-response.js';
import { relationshipDeleteSchema } from '#lib/server/validation/schemas.js';
import { parseBody } from '#lib/server/validation/index.js';

/**
 * Delete a specific relationship edge or union (never a person). Accepts
 * `remove_parent_child`, `remove_partner_from_union`, and `destroy_union`. Callers show the
 * impact endpoint's preview first.
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
		const command = parseBody(relationshipDeleteSchema, await request.json().catch(() => ({})));
		const db = getDb(platform.env.DB);
		const service = new RelationshipService(db);

		const { change } = await service.removeRelationship(treeId, command, {
			user: locals.user,
			correlationId: locals.correlationId
		});

		return Response.json({ success: true, change });
	} catch (err) {
		return errorResponse(err, 'Failed to remove relationship');
	}
};