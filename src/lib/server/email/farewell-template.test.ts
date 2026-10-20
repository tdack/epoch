import { describe, expect, it } from 'vitest';
import { renderFarewellEmail } from './farewell-template';

const input = {
	name: 'Grace Hopper',
	origin: 'https://epoch.example.com',
	trees: [
		{ name: 'The Hopper Family', owners: [{ name: 'Ada Lovelace', email: 'ada@example.com' }] },
		{ name: 'Ships', owners: [{ name: null, email: 'bob@example.com' }] }
	]
};

describe('farewell email', () => {
	it('says what is removed, what stays, and who to ask, in both parts', () => {
		const { subject, html, text } = renderFarewellEmail(input);
		expect(subject).toBe('Sorry to see you go');
		for (const part of [html, text]) {
			expect(part).toContain('Grace Hopper');
			expect(part).toContain('The Hopper Family');
			expect(part).toContain('Ada Lovelace');
			expect(part).toContain('ada@example.com');
			expect(part).toContain('bob@example.com');
			expect(part).toContain('your settings and your profile picture');
			expect(part).toContain('history under your name');
			expect(part).toContain('invite you again');
		}
		expect(html).toContain('https://epoch.example.com/brand/icon-192.png');
	});

	it('escapes hostile text in the HTML', () => {
		const { html } = renderFarewellEmail({
			...input,
			name: '<script>alert(1)</script>',
			trees: [{ name: '"><img src=x onerror=alert(2)>', owners: [{ name: '<b>', email: 'a@b.c' }] }]
		});
		expect(html).not.toContain('<script>');
		expect(html).not.toContain('<img src=x');
		expect(html).not.toContain('<b>');
	});

	it('copes with no name and no trees', () => {
		const { text } = renderFarewellEmail({ ...input, name: null, trees: [] });
		expect(text.startsWith('Hello,')).toBe(true);
		expect(text).not.toContain('You were a member of');
	});
});
