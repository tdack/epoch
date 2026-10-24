import { describe, expect, it } from 'vitest';
import { renderInvitationAcceptedEmail } from './invitation-accepted-template';

const input = {
	inviteeName: 'Grace Hopper',
	inviteeEmail: 'grace@example.com',
	treeName: 'The Lovelace Family',
	role: 'editor' as const,
	membersUrl: 'https://epoch.example.com/trees/abc/members'
};

describe('invitation accepted email', () => {
	it('names the invitee, tree, role and members link in both parts', () => {
		const { subject, html, text } = renderInvitationAcceptedEmail(input);
		expect(subject).toBe('Grace Hopper joined The Lovelace Family on Epoch');
		for (const part of [html, text]) {
			for (const piece of [
				'Grace Hopper',
				'grace@example.com',
				'The Lovelace Family',
				'editor',
				'https://epoch.example.com/trees/abc/members'
			])
				expect(part).toContain(piece);
		}
	});

	it('escapes hostile text in the HTML', () => {
		const { html } = renderInvitationAcceptedEmail({
			...input,
			inviteeName: '<script>x</script>',
			treeName: '"><img src=x>'
		});
		expect(html).not.toContain('<script>x');
		expect(html).not.toContain('<img src=x>');
	});
});
