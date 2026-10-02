import { card, expect, test, openTree } from './support';

test('deleting a person lists exactly what goes and needs confirmation', async ({ page, api }) => {
	const [homer, marge, bart] = [
		await api.addPerson('Homer', 'Simpson'),
		await api.addPerson('Marge', 'Simpson'),
		await api.addPerson('Bart', 'Simpson')
	];
	await api.partner(homer, marge);
	await api.child(homer, bart);
	await openTree(page, api, homer);

	await card(page, 'Homer').click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Delete person…' }).click();

	const dialog = page.getByRole('dialog', { name: 'Delete Homer Simpson?' });
	await expect(dialog).toBeVisible();
	await expect(dialog.getByText('Homer Simpson', { exact: true })).toBeVisible();
	await expect(dialog.getByText('Marge Simpson', { exact: true })).toBeVisible();
	await expect(dialog.getByText('Bart Simpson', { exact: true })).toBeVisible();
	await expect(dialog.getByText('Homer Simpson as biological parent of Bart Simpson')).toBeVisible();

	// Cancel is the default action, and cancelling changes nothing.
	await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	expect((await api.graph()).people).toHaveLength(3);

	await card(page, 'Homer').click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Delete person…' }).click();
	await dialog.getByRole('button', { name: 'Delete person' }).click();

	await expect(page.getByRole('status').filter({ hasText: 'Deleted Homer Simpson' })).toBeVisible();
	const graph = await api.graph();
	expect(graph.people.map((p) => p.displayName).sort()).toEqual(['Marge Simpson', 'Bart Simpson']);
	expect(graph.parentChild).toEqual([]);
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
