import { treeHandler } from '#lib/server/http/handler.js';
import { MemberService } from '#lib/server/services/member-service.js';
import { selfPersonSchema } from '#lib/server/validation/schemas.js';

/** Which person a member is in this tree (`null` clears it): their own, or a manager's for them. */
export const PUT = treeHandler(
	{ failure: 'Failed to save who they are', params: ['userId'], body: selfPersonSchema },
	async ({ db, ctx, treeId, params, body }) => {
		await new MemberService(db).setPerson(treeId, params.userId, body.personId, ctx);
		return new Response(null, { status: 204 });
	}
);
