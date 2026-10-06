import { card, expect, open, openTree, test, type Api, type Person } from './support';
import type { Page } from '@playwright/test';

const DRAWER = 'div.fixed.inset-y-0';

async function openDrawer(page: Page, api: Api, who: Person) {
	await openTree(page, api, who);
	await card(page, who.givenName).dblclick();
	const drawer = page.locator(DRAWER);
	await expect(drawer.getByRole('heading', { name: new RegExp(who.givenName) })).toBeVisible();
	return drawer;
}

test('a fact and a name are edited from the drawer, and the drawer shows the result', async ({
	page,
	api
}) => {
	const wren = await api.addPerson('Wren', 'Ash', { birthDate: '4 MAR 1900', birthPlace: 'Leeds' });
	const drawer = await openDrawer(page, api, wren);

	// Facts is open by default.
	await drawer.getByRole('button', { name: 'Edit Birth' }).click();
	const edit = page.getByRole('dialog', { name: 'Edit fact' });
	await edit.getByLabel('Place').fill('York');
	await edit.getByRole('button', { name: 'Save fact' }).click();
	await expect(edit).toBeHidden();
	await expect(drawer.getByTestId('fact')).toContainText('York');

	// Names starts closed; opening it is a click on its heading.
	await expect(drawer.getByRole('button', { name: 'Add name' })).toBeHidden();
	await drawer.getByRole('heading', { name: 'Names' }).click();
	await drawer.getByRole('button', { name: 'Add name' }).click();
	const dialog = page.getByRole('dialog', { name: 'Add a name' });
	await dialog.getByLabel('Type').selectOption('married');
	await dialog.getByLabel('Given names').fill('Wren');
	await dialog.getByLabel('Surname', { exact: true }).fill('Birch');
	await dialog.getByRole('button', { name: 'Add name', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(drawer.getByTestId('name')).toHaveCount(2);
	await expect(drawer.getByTestId('drawer-names')).toContainText('Wren Birch');
});

test('a relative is removed and a file uploaded from the person page', async ({ page, api }) => {
	const mum = await api.addPerson('Mona', 'Marsh');
	const dad = await api.addPerson('Dan', 'Marsh');
	await api.partner(mum, dad);
	await open(page, `/trees/${api.treeId}/people/${encodeURIComponent(mum.id)}`);

	await page
		.getByRole('button', { name: /Options for Dan Marsh: record what happened, or remove/ })
		.click();
	await page
		.getByRole('dialog', { name: /What happened with Dan Marsh/ })
		.getByRole('button', { name: /Not a partner/ })
		.click();
	const confirm = page.getByRole('dialog', { name: /Remove Dan Marsh as a partner/ });
	await confirm.getByRole('button', { name: 'Remove partner' }).click();
	await expect(confirm).toBeHidden();
	await expect
		.poll(async () => (await api.graph()).unions.some((u) => u.partnerIds.includes(dad.id)))
		.toBe(false);

	// A one-pixel PNG is enough to be stored and listed.
	const png = Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
		'base64'
	);
	await page
		.locator('[data-section="media"] input[type="file"]')
		.setInputFiles({ name: 'portrait.png', mimeType: 'image/png', buffer: png });
	await expect(page.getByRole('img', { name: /portrait/ })).toBeVisible();
});

test('the open drawer survives a reload, and Back closes it', async ({ page, api }) => {
	const wren = await api.addPerson('Wren', 'Ash');
	const drawer = await openDrawer(page, api, wren);
	await expect(page).toHaveURL(new RegExp(`person=${wren.id}`));

	await page.reload();
	await expect(drawer.getByRole('heading', { name: /Wren/ })).toBeVisible();

	await page.goBack();
	await expect(page).not.toHaveURL(/person=/);
	await expect(page.locator(DRAWER)).toHaveCount(0);

	await page.goForward();
	await expect(page.locator(DRAWER).getByRole('heading', { name: /Wren/ })).toBeVisible();
});

test('closing the drawer returns focus to the card that opened it', async ({ page, api }) => {
	const wren = await api.addPerson('Wren', 'Ash');
	const drawer = await openDrawer(page, api, wren);
	await expect(drawer.getByRole('heading', { name: /Wren/ })).toBeFocused();

	await page.keyboard.press('Escape');
	await expect(page.locator(DRAWER)).toHaveCount(0);
	await expect(card(page, 'Wren')).toBeFocused();
});
