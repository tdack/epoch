import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { RelationshipService } from '#lib/server/services/relationship-service.js';
import { DomainError } from '#lib/server/domain/errors.js';

export const GET: RequestHandler = async ({ params, locals, platform }) => {
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
		const db = getDb(platform.env.DB);
		const service = new RelationshipService(db);

		const graph = await service.getGraph(treeId, {
			user: locals.user,
			correlationId: locals.correlationId
		});

		return Response.json({ graph });
	} catch (err: any) {
		if (err instanceof DomainError) {
			return Response.json({ error: err.message, code: err.code }, { status: err.status });
		}
		console.error('Failed to load relationship graph:', err);
		return Response.json({ error: err?.message || 'Failed to load relationship graph' }, { status: 500 });
	}
};
