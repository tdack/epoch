import type { SendEmail } from '@cloudflare/workers-types';
import type {
	InvitationAcceptedEmail,
	InvitationEmail,
	InvitationMailer
} from '../services/invitation-mailer';
import { renderInvitationAcceptedEmail } from './invitation-accepted-template';
import { renderInvitationEmail } from './invitation-template';

/**
 * Sends through the `EMAIL` binding. The link is built from the request's origin, not a configured
 * host, so it works on a preview or a custom domain without a setting to forget.
 */
export class WorkersInvitationMailer implements InvitationMailer {
	constructor(
		private binding: SendEmail,
		/** On a domain onboarded to Email Sending and listed in the binding's `allowed_sender_addresses`. */
		private senderAddress: string,
		private origin: string
	) {}

	async sendInvitation(invitation: InvitationEmail): Promise<void> {
		// The tree page, not `/`: it is where the invitee wants to land, and redemption has run by then.
		const signInUrl = new URL(`/trees/${encodeURIComponent(invitation.treeId)}`, this.origin).href;
		const { subject, html, text } = renderInvitationEmail({ ...invitation, signInUrl });
		await this.binding.send({
			from: { email: this.senderAddress, name: 'Epoch' },
			to: invitation.to,
			subject,
			html,
			text
		});
	}

	async sendInvitationAccepted(accepted: InvitationAcceptedEmail): Promise<void> {
		const membersUrl = new URL(`/trees/${encodeURIComponent(accepted.treeId)}/members`, this.origin)
			.href;
		const { subject, html, text } = renderInvitationAcceptedEmail({ ...accepted, membersUrl });
		await this.binding.send({
			from: { email: this.senderAddress, name: 'Epoch' },
			to: accepted.to,
			subject,
			html,
			text
		});
	}

	/** Null where nothing can send (no binding, or no sender configured): callers then skip emailing. */
	static fromEnv(
		env: { EMAIL?: SendEmail; EPOCH_EMAIL_SENDER?: string } | undefined,
		origin: string
	): WorkersInvitationMailer | undefined {
		return env?.EMAIL && env.EPOCH_EMAIL_SENDER
			? new WorkersInvitationMailer(env.EMAIL, env.EPOCH_EMAIL_SENDER, origin)
			: undefined;
	}
}
