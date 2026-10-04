/**
 * The default view (S16 stage 8): the owner sets one for the tree, a member sets their own, and a
 * link with no `mode` opens in the one that applies. A link that names a mode always wins.
 */
import { expect, open, test } from './support';
import type { Page } from '@playwright/test';

const flatCanvas = (page: Page) =>
	page.getByRole('application', { name: 'Family tree', exact: true });
const layersCanvas = (page: Page) =>
	page.getByRole('application', { name: 'Family tree, layers view' });
const floorsCanvas = (page: Page) =>
	page.getByRole('application', { name: 'Family tree, floors view' });

async function chooseDefault(page: Page, label: string, option: string) {
	await page.getByText('Default view', { exact: true }).click();
	await page.getByLabel(label).selectOption({ label: option });
	// Close the disclosure so it does not cover the canvas.
	await page.getByText('Default view', { exact: true }).click();
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

	// The owner sets the tree's default, and a link with no mode now opens in it.
	await chooseDefault(page, 'Default view for everyone', 'Layers');
	await open(page, bare);
	await expect(layersCanvas(page)).toBeVisible();

	// A link that names a mode wins over every default.
	await open(page, `${bare}&mode=flat`);
	await expect(flatCanvas(page)).toBeVisible();

	// Choosing Flat in the toolbar is written into the address, so a reload keeps it.
	await open(page, bare);
	await expect(layersCanvas(page)).toBeVisible();
	await page.getByRole('group', { name: 'Layout' }).getByRole('button', { name: 'Flat' }).click();
	await expect(page).toHaveURL(/mode=flat/);
	await page.reload();
	await expect(flatCanvas(page)).toBeVisible();

	// A member's own choice beats the tree's, and clearing it hands back to the tree's.
	await chooseDefault(page, 'My default view', 'Floors');
	await open(page, bare);
	await expect(floorsCanvas(page)).toBeVisible();
	await chooseDefault(page, 'My default view', 'Tree default (Layers)');
	await open(page, bare);
	await expect(layersCanvas(page)).toBeVisible();

	// Both are saved on the server, so they outlast the page.
	await page.reload();
	await expect(layersCanvas(page)).toBeVisible();
	await page.getByText('Default view', { exact: true }).click();
	await expect(page.getByRole('combobox', { name: 'Default view for everyone' })).toHaveValue(
		'layers'
	);
});
