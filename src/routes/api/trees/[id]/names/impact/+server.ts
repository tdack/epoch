import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { NameService } from '#lib/server/services/name-service.js';
import { errorResponse } from '#lib/server/http/error-response.js';
import { parseBody } from '#lib/server/validation/index.js';
import { nameImpactSchema } from '#lib/server/validation/schemas.js';

/** Preview a name change: exactly which records it would create, change or delete. Saves nothing. */
export const POST: RequestHandler = async ({ params, request, locals, platform }) => {
	if (!locals.user) return Response.json({ error: 'Authentication required' }, { status: 401 });
	const { id: treeId } = params;
	if (!treeId) return Response.json({ error: 'Tree ID required' }, { status: 400 });
	if (!platform?.env?.DB) return Response.json({ error: 'Database binding unavailable' }, { status: 500 });

	try {
		const body = parseBody(nameImpactSchema, await request.json().catch(() => ({})));
		const service = new NameService(getDb(platform.env.DB));
		const context = { user: locals.user, correlationId: locals.correlationId };
		// A previewed create needs an id to plan against; it is discarded, and the save mints its own.
		const command =
			body.kind === 'create_name'
				? { kind: 'create_name' as const, personId: body.personId, nameId: 'preview', isPreferred: body.name.isPreferred, name: body.name as never }
				: body.kind === 'update_name'
					? { kind: 'update_name' as const, nameId: body.nameId, expectedVersion: body.version, name: body.name as never }
					: body.kind === 'delete_name'
						? { kind: 'delete_name' as const, nameId: body.nameId, expectedVersion: body.version }
						: { kind: 'set_preferred_name' as const, personId: body.personId, nameId: body.nameId, expectedVersion: body.version };
		return Response.json({ impact: await service.preview(treeId, command, context) });
	} catch (err) {
		return errorResponse(err, 'Failed to preview the name change');
	}
};
