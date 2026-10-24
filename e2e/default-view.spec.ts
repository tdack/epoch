/**
 * The member's own default view (S16 stage 8, ADR-075): a link with no `mode` opens in the one the
 * member chose, else Flat. A link that names a mode always wins.
 */
import { expect, open, test, type Api } from './support';
import type { Page } from '@playwright/test';

const flatCanvas = (page: Page) =>
	page.getByRole('application', { name: 'Family tree', exact: true });
const ringsCanvas = (page: Page) => page.getByRole('group', { name: 'Generation rings' });

/** The member's own view of this tree, on Account › My trees (ADR-075). */
function viewSelect(page: Page, api: Api) {
	return page
		.getByRole('group')
		.filter({ has: page.locator(`a[href="/trees/${api.treeSlug}"]`) })
		.getByRole('combobox', { name: 'Open in' });
}

async function chooseDefault(page: Page, api: Api, option: string) {
	await open(page, '/account#trees');
	await viewSelect(page, api).selectOption({ label: option });
	// Saved before the next step navigates away: the page says so once the server has it.
	const label = option.split(' ')[0];
	await expect(page.getByText(new RegExp(`opens in ${label}\\.`)).first()).toBeVisible();
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
	await open(page, '/account#trees');
	await expect(viewSelect(page, api).locator('option')).toHaveText([
		'Flat (the default)',
		'Rings',
		'Ball',
		'Ribbons',
		'Orrery'
	]);

	// A member's own choice opens a link with no mode in it.
	await chooseDefault(page, api, 'Rings');
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
	await chooseDefault(page, api, 'Rings');
	await chooseDefault(page, api, 'Flat (the default)');
	await open(page, bare);
	await expect(flatCanvas(page)).toBeVisible();

	// The choice is saved on the server, so it outlasts the page.
	await chooseDefault(page, api, 'Rings');
	await open(page, '/account#trees');
	await expect(viewSelect(page, api)).toHaveValue('rings');
	await open(page, bare);
	await expect(ringsCanvas(page)).toBeVisible();
});
