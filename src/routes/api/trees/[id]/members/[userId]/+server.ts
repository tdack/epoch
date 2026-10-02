import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { MemberService } from '#lib/server/services/member-service.js';
import { errorResponse } from '#lib/server/http/error-response.js';
import { parseBody } from '#lib/server/validation/index.js';
import { changeMemberRoleSchema } from '#lib/server/validation/schemas.js';

/** Change a member's role. `version` is the one the screen loaded; a stale one answers 409. */
export const PATCH: RequestHandler = async ({ params, request, locals, platform }) => {
	if (!locals.user) return Response.json({ error: 'Authentication required' }, { status: 401 });
	const { id: treeId, userId } = params;
	if (!treeId || !userId)
		return Response.json({ error: 'Tree and member required' }, { status: 400 });
	if (!platform?.env?.DB)
		return Response.json({ error: 'Database binding unavailable' }, { status: 500 });

	try {
		const body = parseBody(changeMemberRoleSchema, await request.json().catch(() => ({})));
		const member = await new MemberService(getDb(platform.env.DB)).changeRole(
			treeId,
			userId,
			body,
			{ user: locals.user, correlationId: locals.correlationId }
		);
		return Response.json(member);
	} catch (err) {
		return errorResponse(err, 'Failed to change the role');
	}
};

/** Remove a member; their access ends on their next request. */
export const DELETE: RequestHandler = async ({ params, url, locals, platform }) => {
	if (!locals.user) return Response.json({ error: 'Authentication required' }, { status: 401 });
	const { id: treeId, userId } = params;
	if (!treeId || !userId)
		return Response.json({ error: 'Tree and member required' }, { status: 400 });
	if (!platform?.env?.DB)
		return Response.json({ error: 'Database binding unavailable' }, { status: 500 });

	try {
		const version = Number(url.searchParams.get('version'));
		if (!Number.isInteger(version) || version < 0)
			return Response.json({ error: 'The version the screen loaded is required' }, { status: 400 });
		await new MemberService(getDb(platform.env.DB)).remove(treeId, userId, version, {
			user: locals.user,
			correlationId: locals.correlationId
		});
		return new Response(null, { status: 204 });
	} catch (err) {
		return errorResponse(err, 'Failed to remove the member');
	}
};
