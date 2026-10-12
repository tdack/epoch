import { treeHandler } from '#lib/server/http/handler.js';
import { WorkersInvitationMailer } from '#lib/server/email/workers-invitation-mailer.js';
import { MemberService } from '#lib/server/services/member-service.js';
import { inviteMemberSchema } from '#lib/server/validation/schemas.js';

/**
 * Offer a role to an email address and email them about it. The offer is taken up when that
 * address next signs in through Cloudflare Access; it does not let anyone past Access (ADR-016).
 */
export const POST = treeHandler(
	{ failure: 'Failed to invite', body: inviteMemberSchema, status: 201 },
	({ db, ctx, treeId, body, event, url }) => {
		const binding = event.platform?.env.EMAIL;
		const sender = event.platform?.env.EPOCH_EMAIL_SENDER;
		const mailer =
			binding && sender ? new WorkersInvitationMailer(binding, sender, url.origin) : undefined;
		return new MemberService(db, undefined, mailer).invite(treeId, body, ctx);
	}
);
