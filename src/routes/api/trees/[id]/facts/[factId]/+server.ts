import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { FactService } from '#lib/server/services/fact-service.js';
import { errorResponse } from '#lib/server/http/error-response.js';
import { factUpdateSchema } from '#lib/server/validation/schemas.js';
import { parseBody } from '#lib/server/validation/index.js';

export const PUT: RequestHandler = async ({ params, request, locals, platform }) => {
	if (!locals.user) return Response.json({ error: 'Authentication required' }, { status: 401 });
	const { id: treeId, factId } = params;
	if (!treeId || !factId)
		return Response.json({ error: 'Tree ID and fact ID required' }, { status: 400 });
	if (!platform?.env?.DB)
		return Response.json({ error: 'Database binding unavailable' }, { status: 500 });

	try {
		const { version, ...fact } = parseBody(
			factUpdateSchema,
			await request.json().catch(() => ({}))
		);
		const service = new FactService(getDb(platform.env.DB));
		const { change } = await service.update(treeId, factId, fact, version, {
			user: locals.user,
			correlationId: locals.correlationId
		});
		return Response.json({ change });
	} catch (err) {
		return errorResponse(err, 'Failed to save the fact');
	}
};

export const DELETE: RequestHandler = async ({ params, url, locals, platform }) => {
	if (!locals.user) return Response.json({ error: 'Authentication required' }, { status: 401 });
	const { id: treeId, factId } = params;
	if (!treeId || !factId)
		return Response.json({ error: 'Tree ID and fact ID required' }, { status: 400 });
	if (!platform?.env?.DB)
		return Response.json({ error: 'Database binding unavailable' }, { status: 500 });

	try {
		const versionParam = url.searchParams.get('version');
		const service = new FactService(getDb(platform.env.DB));
		const { change } = await service.remove(
			treeId,
			factId,
			versionParam === null ? undefined : Number(versionParam),
			{ user: locals.user, correlationId: locals.correlationId }
		);
		return Response.json({ change });
	} catch (err) {
		return errorResponse(err, 'Failed to remove the fact');
	}
};
