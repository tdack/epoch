export interface RenderedEmail {
	subject: string;
	html: string;
	text: string;
}

// Tailwind's emerald and stone shades and the paper tone of app.css, written out because an email
// client has no stylesheet to resolve variables from.
export const COLOR = {
	paper: '#fcf9f2',
	card: '#ffffff',
	ink: '#1c1917',
	body: '#44403c',
	muted: '#78716c',
	line: '#e7e5e4',
	accent: '#047857',
	accentDark: '#065f46'
} as const;

export const FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/**
 * The frame every Epoch email shares: the mark and name above a white card, a footer below.
 * Table layout with inline styles and no SVG or web fonts: the clients that matter strip or
 * mangle all three. The mark is the app's PNG icon, fetched from the same origin as the links.
 * `cardHtml` and `footerHtml` are trusted markup: escape every interpolated value before passing them.
 */
export function renderEmailShell(parts: {
	title: string;
	iconUrl: string;
	cardHtml: string;
	footerHtml: string;
}): string {
	const e = escapeHtml;
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(parts.title)}</title>
</head>
<body style="margin:0;padding:0;background-color:${COLOR.paper};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COLOR.paper};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
<tr><td style="padding:0 0 20px 0;font-family:${FONT};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="padding-right:12px;"><img src="${e(parts.iconUrl)}" width="40" height="40" alt="" style="display:block;border:0;border-radius:9px;"></td>
<td style="font-family:${FONT};font-size:22px;font-weight:700;color:${COLOR.accentDark};letter-spacing:0.5px;">Epoch</td>
</tr></table>
</td></tr>
<tr><td style="background-color:${COLOR.card};border:1px solid ${COLOR.line};border-radius:12px;padding:32px;font-family:${FONT};color:${COLOR.body};font-size:16px;line-height:24px;">
${parts.cardHtml}
</td></tr>
<tr><td style="padding:20px 8px 0 8px;font-family:${FONT};font-size:12px;line-height:18px;color:${COLOR.muted};">
${parts.footerHtml}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}
