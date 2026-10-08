/**
 * The default view (S16 stage 8): the owner sets one for the tree, a member sets their own, and a
 * link with no `mode` opens in the one that applies. A link that names a mode always wins.
 */
import { expect, open, test } from './support';
import type { Page } from '@playwright/test';

const flatCanvas = (page: Page) =>
	page.getByRole('application', { name: 'Family tree', exact: true });
const ringsCanvas = (page: Page) => page.getByRole('group', { name: 'Generation rings' });

/** The default-view pickers live in the Display options; opens them, and closes them with Escape. */
async function withDisplay(page: Page, act: () => Promise<void>) {
	await page.getByRole('button', { name: /^Display/ }).click();
	await act();
	await page.keyboard.press('Escape');
}

async function chooseDefault(page: Page, label: string, option: string) {
	await withDisplay(page, () => page.getByLabel(label).selectOption({ label: option }));
}

test('the owner’s tree default, a member’s own choice and an explicit link open the view they should', async ({
	api,
	page
}) => {
	const homer = await api.addPerson('Homer', 'Default');
	const kit = await api.addPerson('Kit', 'Default');
	await api.child(homer, kit);
	const bare = `/trees/${api.treeId}?focus=${encodeURIComponent(homer.id)}`;

	// With nothing chosen a link opens flat.
	await open(page, bare);
	await expect(flatCanvas(page)).toBeVisible();

	// Only Flat and Rings are offered; Layers and Floors are withdrawn (ADR-032).
	await withDisplay(page, () =>
		expect(
			page.getByRole('combobox', { name: 'Default view for everyone' }).locator('option')
		).toHaveText(['Flat', 'Rings'])
	);

	// The owner sets the tree's default, and a link with no mode now opens in it.
	await chooseDefault(page, 'Default view for everyone', 'Rings');
	await open(page, bare);
	await expect(ringsCanvas(page)).toBeVisible();

	// A link that names a mode wins over every default.
	await open(page, `${bare}&mode=flat`);
	await expect(flatCanvas(page)).toBeVisible();

	// Choosing Flat in the toolbar is written into the address, so a reload keeps it.
	await open(page, bare);
	await expect(ringsCanvas(page)).toBeVisible();
	await page.getByRole('group', { name: 'Layout' }).getByRole('button', { name: 'Flat' }).click();
	await expect(page).toHaveURL(/mode=flat/);
	await page.reload();
	await expect(flatCanvas(page)).toBeVisible();

	// A member's own choice beats the tree's, and clearing it hands back to the tree's.
	await chooseDefault(page, 'My default view', 'Flat');
	await open(page, bare);
	await expect(flatCanvas(page)).toBeVisible();
	await chooseDefault(page, 'My default view', 'Tree default (Rings)');
	await open(page, bare);
	await expect(ringsCanvas(page)).toBeVisible();

	// Both are saved on the server, so they outlast the page.
	await page.reload();
	await expect(ringsCanvas(page)).toBeVisible();
	await withDisplay(page, () =>
		expect(page.getByRole('combobox', { name: 'Default view for everyone' })).toHaveValue('rings')
	);
});
