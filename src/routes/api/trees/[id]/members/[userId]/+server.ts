import { treeHandler } from '#lib/server/http/handler.js';
import { MemberService } from '#lib/server/services/member-service.js';
import { changeMemberRoleSchema } from '#lib/server/validation/schemas.js';
import { ValidationError } from '#lib/server/domain/errors.js';

/** Change a member's role. `version` is the one the screen loaded; a stale one answers 409. */
export const PATCH = treeHandler(
	{ failure: 'Failed to change the role', params: ['userId'], body: changeMemberRoleSchema },
	({ db, ctx, treeId, params, body }) =>
		new MemberService(db).changeRole(treeId, params.userId, body, ctx)
);

/** Remove a member; their access ends on their next request. */
export const DELETE = treeHandler(
	{ failure: 'Failed to remove the member', params: ['userId'] },
	async ({ db, ctx, treeId, params, url }) => {
		const version = Number(url.searchParams.get('version'));
		if (!Number.isInteger(version) || version < 0)
			throw new ValidationError('The version the screen loaded is required');
		await new MemberService(db).remove(treeId, params.userId, version, ctx);
		return new Response(null, { status: 204 });
	}
);
