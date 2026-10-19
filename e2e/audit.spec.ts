import { expect, open, test } from './support';

test('undoes an earlier change from the audit log, and one from a person history', async ({
	page,
	api,
	request
}) => {
	await api.addPerson('Ann');
	await api.addPerson('Ben');
	const cara = await api.addPerson('Cara');
	expect((await api.counts()).people).toBe(3);
	// An edit rather than the creation, so the person page is still there once it is undone.
	const edited = await request.put(
		`/api/trees/${api.treeId}/people/${encodeURIComponent(cara.id)}`,
		{
			data: { givenName: 'Cara', surname: 'Reed', version: cara.version }
		}
	);
	expect(edited.ok()).toBe(true);

	// Ann's was not the latest change; the log undoes it anyway.
	const toast = page.getByRole('region', { name: 'Notifications' });
	await open(page, `/trees/${api.treeId}/audit`);
	await page.getByRole('button', { name: /^Undo: Added Ann/ }).click();
	await expect(toast.getByText(/^Undid: Added Ann/)).toBeVisible();
	await expect(page.getByTestId('audit-undone')).toContainText('Undone by');
	await expect.poll(async () => (await api.counts()).people).toBe(2);

	// Filtered to a record, the log says so and offers the way back.
	await open(page, `/trees/${api.treeId}/audit?record=${encodeURIComponent(cara.id)}`);
	await expect(page.getByTestId('audit-filter')).toBeVisible();
	await expect(page.getByTestId('audit-entry')).toHaveCount(2);

	// The same Undo sits in the person's own history, behind a link to the filtered log.
	await open(page, `/trees/${api.treeId}/people/${encodeURIComponent(cara.id)}`);
	await expect(page.getByRole('link', { name: 'See all changes' })).toHaveAttribute(
		'href',
		new RegExp(`/audit\\?record=`)
	);
	await page
		.getByTestId('history')
		.getByRole('button', { name: /^Undo: Edited/ })
		.click();
	await expect(toast.getByText(/^Undid: Edited/)).toBeVisible();
	await expect(page.getByTestId('person-name')).toHaveText('Cara');
});
