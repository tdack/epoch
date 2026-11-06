import { expect, open, test } from './support';

const SHOTS = process.env.E2E_SHOTS ?? 'test-results';

test('an owner invites an address, sees the offer waiting, and withdraws it', async ({
	api,
	page
}) => {
	await open(page, `/trees/${api.treeId}/members`);
	await expect(page.getByTestId('member')).toHaveCount(1);
	await expect(page.getByText('Cloudflare Access is a separate gate')).toBeVisible();

	await page.getByLabel('Email address').fill('Cousin@Example.com');
	await page.getByLabel('Role', { exact: true }).selectOption('editor');
	await page.getByRole('button', { name: 'Invite' }).click();
	await expect(page.getByText('Invited Cousin@Example.com')).toBeVisible();
	const offer = page.getByTestId('invitation');
	await expect(offer).toContainText('cousin@example.com');
	await expect(offer).toContainText('editor');
	await page.screenshot({ path: `${SHOTS}/members-invited.png` });

	await offer.getByRole('button', { name: 'Withdraw' }).click();
	await expect(page.getByTestId('invitation')).toHaveCount(0);
});

test('the only owner cannot be removed or lowered', async ({ api, page }) => {
	await open(page, `/trees/${api.treeId}/members`);
	const me = page.getByTestId('member');
	// The page offers neither; the server's own refusal is covered by the member-service tests.
	const role = me.getByRole('combobox');
	await expect(role).toHaveValue('owner');
	for (const lower of ['manager', 'editor', 'contributor', 'viewer'])
		await expect(role.getByRole('option', { name: lower })).toBeDisabled();
	await expect(me.getByRole('button', { name: 'Remove' })).toHaveCount(0);
	await expect(page.getByTestId('member')).toHaveCount(1);
});
