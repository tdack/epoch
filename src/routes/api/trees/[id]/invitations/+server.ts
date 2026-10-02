import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { MemberService } from '#lib/server/services/member-service.js';
import { errorResponse } from '#lib/server/http/error-response.js';
import { parseBody } from '#lib/server/validation/index.js';
import { inviteMemberSchema } from '#lib/server/validation/schemas.js';

/**
 * Offer a role to an email address. It is taken up when that address next signs in through
 * Cloudflare Access; it does not let anyone past Access (ADR-016).
 */
export const POST: RequestHandler = async ({ params, request, locals, platform }) => {
	if (!locals.user) return Response.json({ error: 'Authentication required' }, { status: 401 });
	const treeId = params.id;
	if (!treeId) return Response.json({ error: 'Tree ID required' }, { status: 400 });
	if (!platform?.env?.DB)
		return Response.json({ error: 'Database binding unavailable' }, { status: 500 });

	try {
		const body = parseBody(inviteMemberSchema, await request.json().catch(() => ({})));
		const invitation = await new MemberService(getDb(platform.env.DB)).invite(treeId, body, {
			user: locals.user,
			correlationId: locals.correlationId
		});
		return Response.json(invitation, { status: 201 });
	} catch (err) {
		return errorResponse(err, 'Failed to invite');
	}
};
