import type { RequestHandler } from '@sveltejs/kit';
import { getDb, ensureDbSchema } from '#lib/server/db/index.js';
import { GenealogyService } from '#lib/server/services/genealogy-service.js';
import { RelationshipService } from '#lib/server/services/relationship-service.js';
import { DomainError } from '#lib/server/domain/errors.js';
import { impactRequestSchema } from '#lib/server/validation/schemas.js';
import { parseBody } from '#lib/server/validation/index.js';

/**
 * Preview a destructive action without doing it: the exact people, partnerships, links and events
 * it would delete or change. The UI shows this before asking for confirmation.
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
		const request_ = parseBody(impactRequestSchema, await request.json().catch(() => ({})));
		await ensureDbSchema(platform.env.DB);
		const db = getDb(platform.env.DB);
		const context = { user: locals.user, correlationId: locals.correlationId };

		if (request_.kind === 'delete_tree') {
			const counts = await new GenealogyService(db).previewDeleteTree(treeId, context);
			return Response.json({ treeImpact: counts });
		}
		if (request_.kind === 'delete_person') {
			const impact = await new GenealogyService(db).previewDeleteIndividual(treeId, request_.personId, context);
			return Response.json({ impact });
		}
		const impact = await new RelationshipService(db).previewRemoval(treeId, request_, context);
		return Response.json({ impact });
	} catch (err: any) {
		if (err instanceof DomainError) {
			return Response.json({ error: err.message, code: err.code, details: err.details }, { status: err.status });
		}
		console.error('Failed to preview impact:', err);
		return Response.json({ error: err?.message || 'Failed to preview impact' }, { status: 500 });
	}
};
