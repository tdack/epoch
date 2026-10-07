import type { TreeRole } from '../../shared/roles';

export interface InvitationTemplateInput {
	inviterName: string;
	treeName: string;
	role: TreeRole;
	expiresAt: Date;
	signInUrl: string;
}

export interface RenderedEmail {
	subject: string;
	html: string;
	text: string;
}

/** What each role allows, in the words the email uses; mirrors the action table in auth/authorization. */
const ROLE_ALLOWS: Record<TreeRole, string> = {
	viewer: 'view the tree',
	contributor: 'view the tree and add people and relationships',
	editor: 'view the tree and add, change and delete records',
	manager: 'do everything an editor can, and manage members, privacy and settings',
	owner: 'do everything a manager can, and delete the tree'
};

// Tailwind's emerald and stone shades and the paper tone of app.css, written out because an email
// client has no stylesheet to resolve variables from.
const COLOR = {
	paper: '#fcf9f2',
	card: '#ffffff',
	ink: '#1c1917',
	body: '#44403c',
	muted: '#78716c',
	line: '#e7e5e4',
	accent: '#047857',
	accentDark: '#065f46'
} as const;

const FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

/** UTC, so the date does not depend on where the Worker happens to run. */
function formatExpiry(date: Date): string {
	return date.toLocaleDateString('en-AU', {
		timeZone: 'UTC',
		day: 'numeric',
		month: 'long',
		year: 'numeric'
	});
}

/**
 * Table layout with inline styles and no SVG or web fonts: the clients that matter strip or
 * mangle all three. The mark is the app's PNG icon, fetched from the same origin as the link.
 */
export function renderInvitationEmail(input: InvitationTemplateInput): RenderedEmail {
	const { inviterName, treeName, role, expiresAt, signInUrl } = input;
	const allows = ROLE_ALLOWS[role];
	const expiry = formatExpiry(expiresAt);
	const subject = `${inviterName} invited you to ${treeName} on Epoch`;
	const iconUrl = new URL('/brand/icon-192.png', signInUrl).href;

	const e = escapeHtml;
	const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${COLOR.paper};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COLOR.paper};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
<tr><td style="padding:0 0 20px 0;font-family:${FONT};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="padding-right:12px;"><img src="${e(iconUrl)}" width="40" height="40" alt="" style="display:block;border:0;border-radius:9px;"></td>
<td style="font-family:${FONT};font-size:22px;font-weight:700;color:${COLOR.accentDark};letter-spacing:0.5px;">Epoch</td>
</tr></table>
</td></tr>
<tr><td style="background-color:${COLOR.card};border:1px solid ${COLOR.line};border-radius:12px;padding:32px;font-family:${FONT};color:${COLOR.body};font-size:16px;line-height:24px;">
<h1 style="margin:0 0 16px 0;font-size:22px;line-height:30px;font-weight:700;color:${COLOR.ink};">You&rsquo;re invited to ${e(treeName)}</h1>
<p style="margin:0 0 16px 0;"><strong style="color:${COLOR.ink};">${e(inviterName)}</strong> has invited you to the family tree <strong style="color:${COLOR.ink};">${e(treeName)}</strong> on Epoch.</p>
<p style="margin:0 0 24px 0;">You&rsquo;ll join as <strong style="color:${COLOR.ink};">${e(role)}</strong>, which lets you ${e(allows)}.</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;"><tr>
<td align="center" bgcolor="${COLOR.accent}" style="border-radius:8px;"><a href="${e(signInUrl)}" style="display:inline-block;padding:13px 28px;font-family:${FONT};font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">Open Epoch</a></td>
</tr></table>
<p style="margin:0 0 8px 0;">Sign in with this exact email address, the one this message was sent to, so the invitation can find you.</p>
<p style="margin:0;color:${COLOR.muted};font-size:14px;line-height:21px;">This invitation expires on ${e(expiry)}.</p>
</td></tr>
<tr><td style="padding:20px 8px 0 8px;font-family:${FONT};font-size:12px;line-height:18px;color:${COLOR.muted};">
If the button does not work, copy this link into your browser:<br>
<a href="${e(signInUrl)}" style="color:${COLOR.accent};word-break:break-all;">${e(signInUrl)}</a><br><br>
Not expecting this? You can ignore the message.
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

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
