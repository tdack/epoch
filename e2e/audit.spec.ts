import { expect, test } from './support';

test('undoes an earlier change from the audit log, and one from a person history', async ({
	page,
	api
}) => {
	await api.addPerson('Ann');
	await api.addPerson('Ben');
	const cara = await api.addPerson('Cara');
	expect((await api.counts()).people).toBe(3);

	// Ann's was not the latest change; the log undoes it anyway.
	await page.goto(`/trees/${api.treeId}/audit`);
	await page.getByRole('button', { name: /^Undo: Added Ann/ }).click();
	await expect(page.getByText(/^Undid: Added Ann/)).toBeVisible();
	await expect(page.getByTestId('audit-undone')).toContainText('Undone by');
	await expect.poll(async () => (await api.counts()).people).toBe(2);

	// Filtered to a record, the log says so and offers the way back.
	await page.goto(`/trees/${api.treeId}/audit?record=${encodeURIComponent(cara.id)}`);
	await expect(page.getByTestId('audit-filter')).toBeVisible();
	await expect(page.getByTestId('audit-entry')).toHaveCount(1);

	// The same Undo sits in the person's own history, behind a link to the filtered log.
	await page.goto(`/trees/${api.treeId}/people/${encodeURIComponent(cara.id)}`);
	await expect(page.getByRole('link', { name: 'See all changes' })).toHaveAttribute(
		'href',
		new RegExp(`/audit\\?record=`)
	);
	await page
		.getByTestId('history')
		.getByRole('button', { name: /^Undo: Added Cara/ })
		.click();
	await expect(page.getByText(/^Undid: Added Cara/)).toBeVisible();
	await expect.poll(async () => (await api.counts()).people).toBe(1);
});
