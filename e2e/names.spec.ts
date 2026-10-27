import { card, expect, open, openTree, test } from './support';

test('a married name is previewed, shown as (née …) on the page and the card, edited, undone and survives export and re-import', async ({
	page,
	api,
	request
}) => {
	const jane = await api.addPerson('Jane', 'Doe');
	const john = await api.addPerson('John', 'Smith');
	await api.partner(jane, john);

	await open(page, `/trees/${api.treeId}/people/${encodeURIComponent(jane.id)}`);
	await expect(page.getByTestId('person-name')).toHaveText('Jane Doe');

	// Add a married name, taken through the partnership, shown from a date. The dialog previews it first.
	await page.getByRole('button', { name: 'Add name' }).click();
	const dialog = page.getByRole('dialog', { name: 'Add a name' });
	await dialog.getByLabel('Type').selectOption('married');
	await dialog.getByLabel('Given names').fill('Jane');
	await dialog.getByLabel('Surname', { exact: true }).fill('Smith');
	await dialog.getByRole('textbox', { name: /In use from/ }).fill('8 OCT 2001');
	await dialog.getByLabel(/Taken through/).selectOption({ label: 'Partnership with John Smith' });
	await dialog.getByLabel('Show this person by this name').check();
	await expect(dialog.getByText('Married name Jane Smith of Jane Doe')).toBeVisible();
	await dialog.getByRole('button', { name: 'Add name', exact: true }).click();
	await expect(dialog).toBeHidden();

	await expect(page.getByTestId('person-name')).toHaveText('Jane Smith (née Doe)');
	const names = page.getByTestId('name');
	await expect(names).toHaveCount(2);
	// The preferred name is listed and exported first, so it cannot move and nothing moves above it.
	await expect(page.getByRole('button', { name: /^Move .* (up|down)$/ })).toHaveCount(0);
	await expect(names.filter({ hasText: 'Married name' }).getByTestId('name-context')).toContainText(
		'In use from 8 October 2001, taken through Partnership with John Smith'
	);

	// The card in the tree says the same.
	await openTree(page, api, jane);
	await expect(card(page, 'Jane')).toContainText('(née Doe)');

	// Edit the married name; undo puts the old text back.
	await open(page, `/trees/${api.treeId}/people/${encodeURIComponent(jane.id)}`);
	await page.getByRole('button', { name: 'Edit Married name' }).click();
	const edit = page.getByRole('dialog', { name: 'Edit name' });
	await edit.getByLabel('Surname', { exact: true }).fill('Smith-Jones');
	await expect(
		edit.getByText('Changed Married name Jane Smith-Jones of Jane Smith (née Doe)')
	).toBeVisible();
	await edit.getByRole('button', { name: 'Save name' }).click();
	await expect(edit).toBeHidden();
	await expect(page.getByTestId('person-name')).toHaveText('Jane Smith-Jones (née Doe)');
	await page.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(page.getByTestId('person-name')).toHaveText('Jane Smith (née Doe)');

	// Export and re-import into a new tree: both names, the date and the partnership come back.
	const exported = await (await request.get(`/api/export?treeId=${api.treeId}`)).text();
	expect(exported).toContain('Name in use from 8 OCT 2001, through family');
	const imported = await request.post('/api/import', {
		multipart: {
			file: { name: 'names.ged', mimeType: 'text/plain', buffer: Buffer.from(exported) },
			treeName: `e2e reimport ${Date.now()}`
		}
	});
	expect(imported.ok()).toBe(true);
	const newTreeId = (await imported.json()).treeId as string;
	try {
		const search = await (await request.get(`/api/trees/${newTreeId}/people-search?q=Doe`)).json();
		expect(search.people).toHaveLength(1);
		await open(page, `/trees/${newTreeId}/people/${encodeURIComponent(search.people[0].id)}`);
		await expect(page.getByTestId('person-name')).toHaveText('Jane Smith (née Doe)');
		await expect(page.getByTestId('name')).toHaveCount(2);
		await expect(page.getByTestId('name-context')).toContainText('In use from 8 October 2001');
	} finally {
		await request.delete(`/api/trees/${newTreeId}`);
	}
});

test('search finds a person by a name they no longer go by', async ({ api, request }) => {
	const jane = await api.addPerson('Jane', 'Roe');
	const res = await request.post(`/api/trees/${api.treeId}/people/${jane.id}/names`, {
		data: { type: 'birth', givenName: 'Jane', surname: 'Doe' }
	});
	expect(res.ok(), await res.text()).toBe(true);
	const found = await (await request.get(`/api/trees/${api.treeId}/people-search?q=Doe`)).json();
	expect(found.people).toMatchObject([{ id: jane.id, matchedName: 'Jane Doe' }]);
});
