import { card, expect, test, openTree } from './support';

test('deleting a person lists exactly what goes and needs confirmation', async ({ page, api }) => {
	const [john, jane, sam] = [
		await api.addPerson('John', 'Smith'),
		await api.addPerson('Jane', 'Smith'),
		await api.addPerson('Sam', 'Smith')
	];
	await api.partner(john, jane);
	await api.child(john, sam);
	await openTree(page, api, john);

	await card(page, 'John').click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Delete person…' }).click();

	const dialog = page.getByRole('dialog', { name: 'Delete John Smith?' });
	await expect(dialog).toBeVisible();
	await expect(dialog.getByText('John Smith', { exact: true })).toBeVisible();
	await expect(dialog.getByText('Jane Smith', { exact: true })).toBeVisible();
	await expect(dialog.getByText('Sam Smith', { exact: true })).toBeVisible();
	await expect(dialog.getByText('John Smith as biological parent of Sam Smith')).toBeVisible();

	// Cancel is the default action, and cancelling changes nothing.
	await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	expect((await api.counts()).people).toBe(3);

	await card(page, 'John').click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Delete person…' }).click();
	await dialog.getByRole('button', { name: 'Delete person' }).click();

	await expect(page.getByRole('status').filter({ hasText: 'Deleted John Smith' })).toBeVisible();
	// Jane and Sam are no longer connected, so each is its own window.
	expect((await api.counts()).people).toBe(2);
	for (const person of [jane, sam]) {
		const graph = await api.graph(person.id);
		expect(graph.people.map((p) => p.displayName)).toEqual([`${person.givenName} Smith`]);
		expect(graph.parentChild).toEqual([]);
	}
});

test('removing a single parent link through the popover leaves the other parent', async ({
	page,
	api
}) => {
	const [a, b, c] = [
		await api.addPerson('Ann'),
		await api.addPerson('Ben'),
		await api.addPerson('Cal')
	];
	await api.partner(a, b);
	await api.child(a, c);
	await api.parent(c, b);
	await openTree(page, api, c);

	await card(page, 'Cal').focus();
	await page.keyboard.press('Tab');
	await page.keyboard.press('Enter');
	const popover = page.getByRole('dialog', { name: /Parent links to Cal/ });
	await popover.getByRole('button', { name: /Remove biological link from Ben/ }).click();

	const dialog = page.getByRole('dialog', { name: 'Remove Ben as a parent of Cal?' });
	await expect(dialog.getByText('Ben as biological parent of Cal')).toBeVisible();
	await dialog.getByRole('button', { name: 'Remove link' }).click();
	await expect(
		page.getByRole('status').filter({ hasText: 'Removed the link between Ben and Cal' })
	).toBeVisible();

	const graph = await api.graph();
	expect(graph.parentChild.map((l) => l.parentId)).toEqual([a.id]);
	expect(graph.people).toHaveLength(3);
});
