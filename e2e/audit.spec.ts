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

	// An occupation writes only its own event row, yet it is still part of Cara's history.
	const fact = await request.post(
		`/api/trees/${api.treeId}/people/${encodeURIComponent(cara.id)}/facts`,
		{ data: { type: 'OCCU', value: 'Weaver' } }
	);
	expect(fact.ok()).toBe(true);

	// Picking a person filters the log to them, and the log says so and offers the way back.
	await open(page, `/trees/${api.treeId}/audit`);
	await page.getByTestId('audit-filters').getByRole('combobox', { name: 'Person' }).fill('Cara');
	await page.getByRole('option', { name: /Cara/ }).click();
	await page.getByRole('button', { name: 'Filter' }).click();
	await expect(page).toHaveURL(new RegExp(`record=${encodeURIComponent(cara.id)}`));
	await expect(page.getByTestId('audit-filter')).toContainText('changes to Cara');
	await expect(page.getByTestId('audit-entry')).toHaveCount(3);
	await page.getByTestId('audit-filter').getByRole('link', { name: 'Any person' }).click();
	await expect(page).not.toHaveURL(/record=/);

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

test.use({ timezoneId: 'Australia/Adelaide' });

test('filters the log by who made the change, and moves between numbered pages', async ({
	page,
	api
}) => {
	for (let i = 0; i < 27; i++) await api.addPerson(`Person${i}`);
	await open(page, `/trees/${api.treeId}/audit`);
	await expect(page.getByTestId('audit-entry')).toHaveCount(25);

	await page.getByTestId('audit-pager').getByRole('link', { name: 'Page 2' }).click();
	await expect(page).toHaveURL(/page=2/);
	await expect(page.getByTestId('audit-entry')).toHaveCount(2);
	await expect(page.getByTestId('audit-pager').locator('[aria-current="page"]')).toHaveText('2');

	// Changing a filter starts again from the first page.
	await page.getByLabel('Made by').selectOption({ index: 1 });
	await page.getByRole('button', { name: 'Filter' }).click();
	await expect(page).toHaveURL(/actor=/);
	await expect(page).not.toHaveURL(/page=/);
	await expect(page.getByTestId('audit-entry')).toHaveCount(25);

	// A day with no changes is an empty filtered list, and clearing brings the log back.
	await page.getByLabel('From', { exact: true }).fill('2001-01-01');
	await page.getByLabel('To', { exact: true }).fill('2001-01-02');
	await page.getByRole('button', { name: 'Filter' }).click();
	await expect(page.getByTestId('audit-empty')).toContainText('No changes match these filters');
	await expect(page).toHaveURL(/tz=Australia%2FAdelaide/);
	await expect(page.getByTestId('audit-filters')).toContainText('Australia/Adelaide time');
	await page.getByTestId('audit-clear').click();
	await expect(page.getByTestId('audit-entry')).toHaveCount(25);
});
