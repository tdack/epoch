import { card, expect, openTree, test } from './support';

test('changing one parent’s link to adoptive previews the change, leaves the other parent, and undoes', async ({
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
	// Each parent has their own control: the two links are not one "pedigree".
	await expect(popover.getByRole('combobox')).toHaveCount(2);
	await popover.getByRole('combobox', { name: /from Ben to/ }).selectOption('adoptive');

	const dialog = page.getByRole('dialog', { name: "Change Ben's link to Cal?" });
	await expect(dialog.getByText('Ben as adoptive parent of Cal')).toBeVisible();
	await dialog.getByRole('button', { name: 'Change type' }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Ben' })).toBeVisible();

	const types = async () =>
		Object.fromEntries(
			(await api.graph()).parentChild.map((l) => [l.parentId === a.id ? 'ann' : 'ben', l.type])
		);
	expect(await types()).toEqual({ ann: 'biological', ben: 'adoptive' });

	await page.getByRole('button', { name: 'Undo' }).click();
	await expect.poll(types).toEqual({ ann: 'biological', ben: 'biological' });
});
