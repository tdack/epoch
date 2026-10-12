import type { SendEmail } from '@cloudflare/workers-types';
import type { InvitationEmail, InvitationMailer } from '../services/invitation-mailer';
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
}
