import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { FactService } from '#lib/server/services/fact-service.js';
import { errorResponse } from '#lib/server/http/error-response.js';
import { factImpactSchema } from '#lib/server/validation/schemas.js';
import { parseBody } from '#lib/server/validation/index.js';

/** Preview a fact change: exactly which records it would create, change or delete. Saves nothing. */
export const POST: RequestHandler = async ({ params, request, locals, platform }) => {
	if (!locals.user) return Response.json({ error: 'Authentication required' }, { status: 401 });
	const { id: treeId } = params;
	if (!treeId) return Response.json({ error: 'Tree ID required' }, { status: 400 });
	if (!platform?.env?.DB)
		return Response.json({ error: 'Database binding unavailable' }, { status: 500 });

	try {
		const body = parseBody(factImpactSchema, await request.json().catch(() => ({})));
		const service = new FactService(getDb(platform.env.DB));
		const context = { user: locals.user, correlationId: locals.correlationId };
		// A previewed create needs an id to plan against; it is discarded, and the save mints its own.
		const command =
			body.kind === 'create_fact'
				? {
						kind: 'create_fact' as const,
						personId: body.personId,
						factId: 'preview',
						fact: body.fact
					}
				: body.kind === 'update_fact'
					? {
							kind: 'update_fact' as const,
							factId: body.factId,
							expectedVersion: body.version,
							fact: body.fact
						}
					: { kind: 'delete_fact' as const, factId: body.factId, expectedVersion: body.version };
		return Response.json({ impact: await service.preview(treeId, command, context) });
	} catch (err) {
		return errorResponse(err, 'Failed to preview the fact change');
	}
};
