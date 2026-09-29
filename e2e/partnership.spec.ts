import { card, chooseMenuItem, expect, openMenuByKeyboard, openTree, test } from './support';

test('ending a union shows the ended connector', async ({ page, api }) => {
	const [a, b] = [await api.addPerson('Ann'), await api.addPerson('Ben')];
	await api.partner(a, b);
	await openTree(page, api, a);
	await expect(page.locator('path.line.partner.ended')).toHaveCount(0);

	await openMenuByKeyboard(page, 'Ann');
	await chooseMenuItem(page, 'End partnership…');
	const dialog = page.getByRole('dialog', { name: 'End partnership' });
	// One partnership, so it is chosen already; the status defaults to divorced with a divorce event.
	await expect(dialog.getByText('The partnership between Ann and Ben will be recorded as divorced.')).toBeVisible();
	await dialog.getByLabel('Date', { exact: true }).fill('12 MAR 1999');
	await expect(dialog.getByText('recorded as divorced (12 MAR 1999)')).toBeVisible();
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();

	// A horizontal connector has no height, so it is attached rather than "visible" to Playwright.
	await expect(page.locator('path.line.partner.ended').first()).toBeAttached();
	await expect(page.getByText('div. 12 MAR 1999')).toBeVisible();
	const union = (await api.graph()).unions[0];
	expect(union.status).toBe('divorced');
	expect(union.events).toMatchObject([{ type: 'DIV', dateText: '12 MAR 1999' }]);
});

test('with several partnerships the person must choose which one to end', async ({ page, api }) => {
	const [a, b, c] = [await api.addPerson('Ann'), await api.addPerson('Ben'), await api.addPerson('Cal')];
	await api.partner(a, b);
	await api.partner(a, c);
	await openTree(page, api, a);

	await openMenuByKeyboard(page, 'Ann');
	await chooseMenuItem(page, 'End partnership…');
	const dialog = page.getByRole('dialog', { name: 'End partnership' });
	await expect(dialog.getByRole('radio')).toHaveCount(2);
	await expect(dialog.getByRole('radio', { checked: true })).toHaveCount(0);
	await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
	await dialog.getByRole('radio', { name: /with Cal/ }).check();
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();

	await expect.poll(async () => (await api.graph()).unions.map((u) => u.status).sort()).toEqual(['active', 'divorced']);
});

test('recording a death shows the dagger and explains the widowhood before saving', async ({ page, api }) => {
	const [homer, marge] = [await api.addPerson('Homer', 'Simpson'), await api.addPerson('Marge', 'Simpson')];
	await api.partner(homer, marge);
	await openTree(page, api, homer);

	await openMenuByKeyboard(page, 'Homer');
	await chooseMenuItem(page, 'Record death…');
	const dialog = page.getByRole('dialog', { name: 'Record death' });
	await dialog.getByLabel('Date of death').fill('3 MAR 2001');
	await dialog.getByLabel('Place of death').fill('Brisbane');
	await expect(dialog.getByText('Marge Simpson will be shown as widowed in their partnership with Homer Simpson.')).toBeVisible();
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();

	await expect(card(page, 'Homer')).toContainText('†');
	const graph = await api.graph();
	expect(graph.people.find((p) => p.id === homer.id)).toMatchObject({ isDeceased: true, deathDate: '3 MAR 2001' });
	// Death did not touch the partnership.
	expect(graph.unions[0].status).toBe('active');

	// The drawer states the derived widowhood.
	await card(page, 'Marge').click();
	await expect(page.getByText('· widowed')).toBeVisible();
});

test('editing a partnership updates the label on the canvas', async ({ page, api }) => {
	const [a, b] = [await api.addPerson('Ann'), await api.addPerson('Ben')];
	await api.partner(a, b);
	await openTree(page, api, a);

	await page.locator('[data-union-id]').click();
	const dialog = page.getByRole('dialog', { name: 'Edit partnership' });
	await dialog.getByLabel('Add an event').selectOption('MARR');
	await dialog.getByRole('button', { name: 'Add', exact: true }).click();
	await dialog.getByLabel('Date').fill('1975');
	await dialog.getByRole('button', { name: 'Save' }).click();

	await expect(page.locator('text.label', { hasText: '1975' })).toBeVisible();
});
