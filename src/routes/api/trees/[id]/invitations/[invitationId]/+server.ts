import { treeHandler } from '#lib/server/http/handler.js';
import { MemberService } from '#lib/server/services/member-service.js';

/** Withdraw a pending invitation. */
export const DELETE = treeHandler(
	{ failure: 'Failed to withdraw the invitation', params: ['invitationId'] },
	async ({ db, ctx, treeId, params }) => {
		await new MemberService(db).revokeInvitation(treeId, params.invitationId, ctx);
		return new Response(null, { status: 204 });
	}
);
