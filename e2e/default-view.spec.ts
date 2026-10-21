/**
 * The member's own default view (S16 stage 8, ADR-075): a link with no `mode` opens in the one the
 * member chose, else Flat. A link that names a mode always wins.
 */
import { expect, open, test } from './support';
import type { Page } from '@playwright/test';

const flatCanvas = (page: Page) =>
	page.getByRole('application', { name: 'Family tree', exact: true });
const ringsCanvas = (page: Page) => page.getByRole('group', { name: 'Generation rings' });

/** The default-view picker lives in the Display options; opens them, and closes them with Escape. */
async function withDisplay(page: Page, act: () => Promise<void>) {
	await page.getByRole('button', { name: /^Display/ }).click();
	await act();
	await page.keyboard.press('Escape');
}

async function chooseDefault(page: Page, option: string) {
	await withDisplay(page, () =>
		page.getByLabel('Open this tree in').selectOption({ label: option })
	);
}

test('a member’s own default view and an explicit link open the view they should', async ({
	api,
	page
}) => {
	const john = await api.addPerson('John', 'Default');
	const kit = await api.addPerson('Kit', 'Default');
	await api.child(john, kit);
	const bare = `/trees/${api.treeId}?focus=${encodeURIComponent(john.id)}`;

	// With nothing chosen a link opens flat.
	await open(page, bare);
	await expect(flatCanvas(page)).toBeVisible();

	// Flat and the four WebGL views are offered.
	await withDisplay(page, () =>
		expect(page.getByRole('combobox', { name: 'Open this tree in' }).locator('option')).toHaveText([
			'Flat (the default)',
			'Rings',
			'Ball',
			'Ribbons',
			'Orrery'
		])
	);

	// A member's own choice opens a link with no mode in it.
	await chooseDefault(page, 'Rings');
	await open(page, bare);
	await expect(ringsCanvas(page)).toBeVisible();

	// A link that names a mode wins over the member's choice.
	await open(page, `${bare}&mode=flat`);
	await expect(flatCanvas(page)).toBeVisible();

	// Choosing Flat in the toolbar is written into the address, so a reload keeps it.
	await open(page, bare);
	await expect(ringsCanvas(page)).toBeVisible();
	await page.getByRole('group', { name: 'Layout' }).getByRole('button', { name: 'Flat' }).click();
	await expect(page).toHaveURL(/mode=flat/);
	await page.reload();
	await expect(flatCanvas(page)).toBeVisible();

	// Clearing the choice hands back to Flat.
	await chooseDefault(page, 'Rings');
	await chooseDefault(page, 'Flat (the default)');
	await open(page, bare);
	await expect(flatCanvas(page)).toBeVisible();

	// The choice is saved on the server, so it outlasts the page.
	await chooseDefault(page, 'Rings');
	await page.reload();
	await open(page, bare);
	await expect(ringsCanvas(page)).toBeVisible();
	await withDisplay(page, () =>
		expect(page.getByRole('combobox', { name: 'Open this tree in' })).toHaveValue('rings')
	);
});
