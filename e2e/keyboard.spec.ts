import {
	activate,
	card,
	DRAWER,
	chooseMenuItem,
	expect,
	openMenuByKeyboard,
	openTree,
	test
} from './support';

test('a keyboard-only flow adds a parent and a partner', async ({ page, api }) => {
	const sam = await api.addPerson('Sam', 'Smith');
	await openTree(page, api, sam);

	// Add a parent: menu from the card, form filled and saved without the mouse.
	await openMenuByKeyboard(page, 'Sam');
	await chooseMenuItem(page, 'Add relationship');
	const dialog = page.getByRole('dialog', { name: 'Add relationship' });
	await expect(dialog).toBeVisible();
	await activate(dialog.getByRole('button', { name: 'Add parent' }));
	await activate(dialog.getByRole('button', { name: 'New person' }));
	await dialog.getByLabel('Given name').focus();
	await page.keyboard.type('Nia');
	await dialog.getByLabel('Surname').focus();
	await page.keyboard.type('Novak');
	await expect(
		dialog.getByText("Nia Novak will be recorded as Sam Smith's biological parent.")
	).toBeVisible();
	await activate(dialog.getByRole('button', { name: 'Save', exact: true }));

	await expect(
		page.getByRole('status').filter({ hasText: 'Nia Novak was recorded' })
	).toBeVisible();
	await expect(card(page, 'Nia')).toBeVisible();
	// Closing a dialog hands focus back to where it came from.
	await expect(card(page, 'Sam')).toBeFocused();

	// Add a partner the same way.
	await openMenuByKeyboard(page, 'Sam');
	await chooseMenuItem(page, 'Add relationship');
	await activate(dialog.getByRole('button', { name: 'Add partner' }));
	await activate(dialog.getByRole('button', { name: 'New person' }));
	await dialog.getByLabel('Given name').focus();
	await page.keyboard.type('Pat');
	await expect(dialog.getByText("Pat will be recorded as Sam Smith's partner.")).toBeVisible();
	await activate(dialog.getByRole('button', { name: 'Save', exact: true }));
	await expect(card(page, 'Pat')).toBeVisible();

	const graph = await api.graph();
	const byName = (n: string) => graph.people.find((p) => p.displayName.startsWith(n))!;
	expect(graph.parentChild).toEqual([
		{ parentId: byName('Nia').id, childId: sam.id, type: 'biological', unionId: null }
	]);
	expect(graph.unions).toHaveLength(1);
	expect([...graph.unions[0].partnerIds].sort()).toEqual([sam.id, byName('Pat').id].sort());
});

test('Tab from a person reaches its edges and partnership, and Enter opens them', async ({
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
	// The next stop is the merged parent link into Cal, with a name that says what it is.
	const edge = page.locator('[data-edge-id]:focus');
	await expect(edge).toHaveAttribute('aria-label', /Parent link to Cal, from Ann and Ben/);
	await page.keyboard.press('Enter');

	const popover = page.getByRole('dialog', { name: /Parent links to Cal/ });
	await expect(popover).toBeVisible();
	// Focus is trapped: Tab wraps within the popover.
	const buttons = popover.getByRole('button');
	const count = await buttons.count();
	for (let i = 0; i < count + 1; i++) await page.keyboard.press('Tab');
	await expect(popover.locator(':focus')).toHaveCount(1);
	await page.keyboard.press('Escape');
	await expect(popover).toBeHidden();
	// ...and is handed back to the edge that opened it.
	await expect(edge).toBeFocused();
});

test('a partnership node is reachable by Tab and Enter opens its editor', async ({ page, api }) => {
	const [a, b] = [await api.addPerson('Ann'), await api.addPerson('Ben')];
	await api.partner(a, b);
	await openTree(page, api, a);

	await card(page, 'Ann').focus();
	const union = page.locator('[data-union-id]');
	for (let i = 0; i < 6 && !(await union.evaluate((el) => el === document.activeElement)); i++)
		await page.keyboard.press('Tab');
	await expect(union).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('dialog', { name: 'Edit partnership' })).toBeVisible();
});

test('the card menu opens the details drawer', async ({ page, api }) => {
	const john = await api.addPerson('John', 'Smith');
	await openTree(page, api, john);
	await openMenuByKeyboard(page, 'John');
	await chooseMenuItem(page, 'Show details');
	await expect(page.locator(DRAWER).getByRole('heading', { name: /John Smith/ })).toBeVisible();
});

test('the card menu opens the profile page', async ({ page, api }) => {
	const john = await api.addPerson('John', 'Smith');
	await openTree(page, api, john);
	await openMenuByKeyboard(page, 'John');
	await page.keyboard.press('ArrowDown');
	await expect(page.getByRole('menuitem', { name: 'Open profile' })).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(/\/people\/[^/?]+$/);
	await expect(page.getByRole('heading', { name: /John Smith/ }).first()).toBeVisible();
});
