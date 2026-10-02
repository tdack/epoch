import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { MemberService } from '#lib/server/services/member-service.js';
import { errorResponse } from '#lib/server/http/error-response.js';

/** The tree's members and pending invitations, for a manager or owner (ADR-016). */
export const GET: RequestHandler = async ({ params, locals, platform }) => {
	if (!locals.user) return Response.json({ error: 'Authentication required' }, { status: 401 });
	const treeId = params.id;
	if (!treeId) return Response.json({ error: 'Tree ID required' }, { status: 400 });
	if (!platform?.env?.DB)
		return Response.json({ error: 'Database binding unavailable' }, { status: 500 });

	try {
		return Response.json(
			await new MemberService(getDb(platform.env.DB)).list(treeId, {
				user: locals.user,
				correlationId: locals.correlationId
			})
		);
	} catch (err) {
		return errorResponse(err, 'Failed to list the members');
	}
};
