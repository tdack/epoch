import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { NameService } from '#lib/server/services/name-service.js';
import { errorResponse } from '#lib/server/http/error-response.js';
import { parseBody } from '#lib/server/validation/index.js';
import { nameUpdateSchema } from '#lib/server/validation/schemas.js';

export const PUT: RequestHandler = async ({ params, request, locals, platform }) => {
	if (!locals.user) return Response.json({ error: 'Authentication required' }, { status: 401 });
	const { id: treeId, nameId } = params;
	if (!treeId || !nameId)
		return Response.json({ error: 'Tree ID and name ID required' }, { status: 400 });
	if (!platform?.env?.DB)
		return Response.json({ error: 'Database binding unavailable' }, { status: 500 });

	try {
		const { version, ...name } = parseBody(
			nameUpdateSchema,
			await request.json().catch(() => ({}))
		);
		const service = new NameService(getDb(platform.env.DB));
		const { change } = await service.update(treeId, nameId, name as never, version, {
			user: locals.user,
			correlationId: locals.correlationId
		});
		return Response.json({ change });
	} catch (err) {
		return errorResponse(err, 'Failed to save the name');
	}
};

export const DELETE: RequestHandler = async ({ params, url, locals, platform }) => {
	if (!locals.user) return Response.json({ error: 'Authentication required' }, { status: 401 });
	const { id: treeId, nameId } = params;
	if (!treeId || !nameId)
		return Response.json({ error: 'Tree ID and name ID required' }, { status: 400 });
	if (!platform?.env?.DB)
		return Response.json({ error: 'Database binding unavailable' }, { status: 500 });

	try {
		const versionParam = url.searchParams.get('version');
		const service = new NameService(getDb(platform.env.DB));
		const { change } = await service.remove(
			treeId,
			nameId,
			versionParam === null ? undefined : Number(versionParam),
			{
				user: locals.user,
				correlationId: locals.correlationId
			}
		);
		return Response.json({ change });
	} catch (err) {
		return errorResponse(err, 'Failed to remove the name');
	}
};
