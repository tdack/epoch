import { treeHandler } from '#lib/server/http/handler.js';
import { MemberService } from '#lib/server/services/member-service.js';
import { inviteMemberSchema } from '#lib/server/validation/schemas.js';

/**
 * Offer a role to an email address. It is taken up when that address next signs in through
 * Cloudflare Access; it does not let anyone past Access (ADR-016).
 */
export const POST = treeHandler(
	{ failure: 'Failed to invite', body: inviteMemberSchema, status: 201 },
	({ db, ctx, treeId, body }) => new MemberService(db).invite(treeId, body, ctx)
);
