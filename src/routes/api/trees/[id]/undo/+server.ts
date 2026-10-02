import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { ChangeLogService } from '#lib/server/services/change-log-service.js';
import { errorResponse } from '#lib/server/http/error-response.js';

/** What "Undo" would revert next for the signed-in user, or null. */
export const GET: RequestHandler = async ({ params, locals, platform }) => {
	if (!locals.user) {
		return Response.json({ error: 'Authentication required' }, { status: 401 });
	}
	const { id: treeId } = params;
	if (!treeId) return Response.json({ error: 'Tree ID required' }, { status: 400 });
	if (!platform?.env?.DB)
		return Response.json({ error: 'Database binding unavailable' }, { status: 500 });

	try {
		const service = new ChangeLogService(getDb(platform.env.DB));
		const next = await service.peekUndo(treeId, {
			user: locals.user,
			correlationId: locals.correlationId
		});
		return Response.json({ next });
	} catch (err) {
		return errorResponse(err, 'Failed to look up undo');
	}
};

/** Undo the signed-in user's most recent undoable change in this tree. */
export const POST: RequestHandler = async ({ params, locals, platform }) => {
	if (!locals.user) {
		return Response.json({ error: 'Authentication required' }, { status: 401 });
	}
	const { id: treeId } = params;
	if (!treeId) return Response.json({ error: 'Tree ID required' }, { status: 400 });
	if (!platform?.env?.DB)
		return Response.json({ error: 'Database binding unavailable' }, { status: 500 });

	try {
		const service = new ChangeLogService(getDb(platform.env.DB));
		const { undone, change } = await service.undoLast(treeId, {
			user: locals.user,
			correlationId: locals.correlationId
		});
		return Response.json({ success: true, undone, change });
	} catch (err) {
		return errorResponse(err, 'Failed to undo');
	}
};
