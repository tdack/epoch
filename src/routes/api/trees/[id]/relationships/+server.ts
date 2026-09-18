import type { RequestHandler } from '@sveltejs/kit';
import { getDb, ensureDbSchema } from '#lib/server/db/index.js';
import { RelationshipService } from '#lib/server/services/relationship-service.js';
import { DomainError } from '#lib/server/domain/errors.js';
import type { RelationshipIntent } from '#lib/server/domain/relationship-sentence.js';

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

	const body = (await request.json().catch(() => ({}))) as { intent?: RelationshipIntent };
	if (!body.intent) {
		return Response.json({ error: 'intent is required' }, { status: 400 });
	}

	try {
		await ensureDbSchema(platform.env.DB);
		const db = getDb(platform.env.DB);
		const service = new RelationshipService(db);

		const plan = await service.execute(treeId, body.intent, {
			user: locals.user,
			correlationId: locals.correlationId
		});

		return Response.json({ success: true, plan }, { status: 201 });
	} catch (err: any) {
		if (err instanceof DomainError) {
			return Response.json({ error: err.message, code: err.code }, { status: err.status });
		}
		console.error('Failed to apply relationship command:', err);
		return Response.json({ error: err?.message || 'Failed to apply relationship command' }, { status: 500 });
	}
};
