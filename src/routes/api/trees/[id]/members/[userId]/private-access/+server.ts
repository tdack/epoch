import { treeHandler } from '#lib/server/http/handler.js';
import { MemberService } from '#lib/server/services/member-service.js';
import { privateAccessSchema } from '#lib/server/validation/schemas.js';

/** Let a viewer or contributor read private people, or stop (managers and owners only). */
export const PUT = treeHandler(
	{ failure: 'Failed to save private access', params: ['userId'], body: privateAccessSchema },
	async ({ db, ctx, treeId, params, body }) => {
		await new MemberService(db).setCanSeePrivate(treeId, params.userId, body.canSeePrivate, ctx);
		return new Response(null, { status: 204 });
	}
);
