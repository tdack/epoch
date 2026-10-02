import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { MemberService } from '#lib/server/services/member-service.js';
import { errorResponse } from '#lib/server/http/error-response.js';

/** Withdraw a pending invitation. */
export const DELETE: RequestHandler = async ({ params, locals, platform }) => {
	if (!locals.user) return Response.json({ error: 'Authentication required' }, { status: 401 });
	const { id: treeId, invitationId } = params;
	if (!treeId || !invitationId)
		return Response.json({ error: 'Tree and invitation required' }, { status: 400 });
	if (!platform?.env?.DB)
		return Response.json({ error: 'Database binding unavailable' }, { status: 500 });

	try {
		await new MemberService(getDb(platform.env.DB)).revokeInvitation(treeId, invitationId, {
			user: locals.user,
			correlationId: locals.correlationId
		});
		return new Response(null, { status: 204 });
	} catch (err) {
		return errorResponse(err, 'Failed to withdraw the invitation');
	}
};
