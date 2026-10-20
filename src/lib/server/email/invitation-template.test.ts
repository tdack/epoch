import { describe, expect, it } from 'vitest';
import { escapeHtml } from './email-shell';
import { renderInvitationEmail } from './invitation-template';

const input = {
	inviterName: 'Ada Lovelace',
	treeName: 'The Lovelace Family',
	role: 'editor' as const,
	expiresAt: new Date('2026-10-15T12:00:00Z'),
	signInUrl: 'https://epoch.example.com/trees/abc'
};

describe('invitation email', () => {
	it('names the tree, role, link and expiry in both parts', () => {
		const { subject, html, text } = renderInvitationEmail(input);
		expect(subject).toBe('Ada Lovelace invited you to The Lovelace Family on Epoch');
		for (const part of [html, text]) {
			expect(part).toContain('The Lovelace Family');
			expect(part).toContain('Ada Lovelace');
			expect(part).toContain('editor');
			expect(part).toContain('https://epoch.example.com/trees/abc');
			expect(part).toContain('15 October 2026');
			expect(part).toContain('Open Epoch');
		}
		expect(html).toContain('https://epoch.example.com/brand/icon-192.png');
		expect(html).not.toContain('<svg');
	});

	it('escapes hostile text in the HTML', () => {
		const { html } = renderInvitationEmail({
			...input,
			inviterName: '<script>alert(1)</script>',
			treeName: '"><img src=x onerror=alert(2)>',
			signInUrl: 'https://epoch.example.com/trees/a"b'
		});
		expect(html).not.toContain('<script>');
		expect(html).not.toContain('<img src=x');
		expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
		expect(html).not.toContain('a"b');
	});

	it('escapes the five HTML metacharacters', () => {
		expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
	});
});
