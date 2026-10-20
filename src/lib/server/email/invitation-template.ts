import type { TreeRole } from '../../shared/roles';
import { COLOR, FONT, escapeHtml, renderEmailShell, type RenderedEmail } from './email-shell';

export type { RenderedEmail };

export interface InvitationTemplateInput {
	inviterName: string;
	treeName: string;
	role: TreeRole;
	expiresAt: Date;
	signInUrl: string;
}

/** What each role allows, in the words the email uses; mirrors the action table in auth/authorization. */
const ROLE_ALLOWS: Record<TreeRole, string> = {
	viewer: 'view the tree',
	contributor: 'view the tree and add people and relationships',
	editor: 'view the tree and add, change and delete records',
	manager: 'do everything an editor can, and manage members, privacy and settings',
	owner: 'do everything a manager can, and delete the tree'
};

/** UTC, so the date does not depend on where the Worker happens to run. */
function formatExpiry(date: Date): string {
	return date.toLocaleDateString('en-AU', {
		timeZone: 'UTC',
		day: 'numeric',
		month: 'long',
		year: 'numeric'
	});
}

export function renderInvitationEmail(input: InvitationTemplateInput): RenderedEmail {
	const { inviterName, treeName, role, expiresAt, signInUrl } = input;
	const allows = ROLE_ALLOWS[role];
	const expiry = formatExpiry(expiresAt);
	const subject = `${inviterName} invited you to ${treeName} on Epoch`;
	const iconUrl = new URL('/brand/icon-192.png', signInUrl).href;

	const e = escapeHtml;
	const html = renderEmailShell({
		title: subject,
		iconUrl,
		cardHtml: `<h1 style="margin:0 0 16px 0;font-size:22px;line-height:30px;font-weight:700;color:${COLOR.ink};">You&rsquo;re invited to ${e(treeName)}</h1>
<p style="margin:0 0 16px 0;"><strong style="color:${COLOR.ink};">${e(inviterName)}</strong> has invited you to the family tree <strong style="color:${COLOR.ink};">${e(treeName)}</strong> on Epoch.</p>
<p style="margin:0 0 24px 0;">You&rsquo;ll join as <strong style="color:${COLOR.ink};">${e(role)}</strong>, which lets you ${e(allows)}.</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;"><tr>
<td align="center" bgcolor="${COLOR.accent}" style="border-radius:8px;"><a href="${e(signInUrl)}" style="display:inline-block;padding:13px 28px;font-family:${FONT};font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">Open Epoch</a></td>
</tr></table>
<p style="margin:0 0 8px 0;">Sign in with this exact email address, the one this message was sent to, so the invitation can find you.</p>
<p style="margin:0;color:${COLOR.muted};font-size:14px;line-height:21px;">This invitation expires on ${e(expiry)}.</p>`,
		footerHtml: `If the button does not work, copy this link into your browser:<br>
<a href="${e(signInUrl)}" style="color:${COLOR.accent};word-break:break-all;">${e(signInUrl)}</a><br><br>
Not expecting this? You can ignore the message.`
	});

	const text = [
		`${inviterName} has invited you to the family tree "${treeName}" on Epoch.`,
		'',
		`You'll join as ${role}, which lets you ${allows}.`,
		'',
		`Open Epoch: ${signInUrl}`,
		'',
		'Sign in with this exact email address, the one this message was sent to, so the invitation can find you.',
		`This invitation expires on ${expiry}.`,
		'',
		'Not expecting this? You can ignore the message.'
	].join('\n');

	return { subject, html, text };
}
