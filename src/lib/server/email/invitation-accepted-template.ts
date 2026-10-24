import type { TreeRole } from '../../shared/roles';
import { COLOR, FONT, escapeHtml, renderEmailShell, type RenderedEmail } from './email-shell';

export interface InvitationAcceptedTemplateInput {
	inviteeName: string;
	inviteeEmail: string;
	treeName: string;
	role: TreeRole;
	membersUrl: string;
}

export function renderInvitationAcceptedEmail(
	input: InvitationAcceptedTemplateInput
): RenderedEmail {
	const { inviteeName, inviteeEmail, treeName, role, membersUrl } = input;
	const subject = `${inviteeName} joined ${treeName} on Epoch`;
	const iconUrl = new URL('/brand/icon-192.png', membersUrl).href;

	const e = escapeHtml;
	const html = renderEmailShell({
		title: subject,
		iconUrl,
		cardHtml: `<h1 style="margin:0 0 16px 0;font-size:22px;line-height:30px;font-weight:700;color:${COLOR.ink};">${e(inviteeName)} joined ${e(treeName)}</h1>
<p style="margin:0 0 24px 0;"><strong style="color:${COLOR.ink};">${e(inviteeName)}</strong> (${e(inviteeEmail)}) accepted your invitation to the family tree <strong style="color:${COLOR.ink};">${e(treeName)}</strong> and joined as <strong style="color:${COLOR.ink};">${e(role)}</strong>.</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px 0;"><tr>
<td align="center" bgcolor="${COLOR.accent}" style="border-radius:8px;"><a href="${e(membersUrl)}" style="display:inline-block;padding:13px 28px;font-family:${FONT};font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">View members</a></td>
</tr></table>`,
		footerHtml: `If the button does not work, copy this link into your browser:<br>
<a href="${e(membersUrl)}" style="color:${COLOR.accent};word-break:break-all;">${e(membersUrl)}</a>`
	});

	const text = [
		`${inviteeName} (${inviteeEmail}) accepted your invitation to the family tree "${treeName}" on Epoch and joined as ${role}.`,
		'',
		`View members: ${membersUrl}`
	].join('\n');

	return { subject, html, text };
}
