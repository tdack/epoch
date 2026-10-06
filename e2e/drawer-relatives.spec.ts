import { card, expect, openTree, test, type Api, type Person } from './support';
import type { Page } from '@playwright/test';

const DRAWER = 'div.fixed.inset-y-0';

/** Two parents who are partners, and a child of both. */
async function family(api: Api) {
	const mum = await api.addPerson('Mona', 'Marsh');
	const dad = await api.addPerson('Dan', 'Marsh');
	const kid = await api.addPerson('Kit', 'Marsh');
	await api.partner(mum, dad);
	await api.child(mum, kid);
	await api.child(dad, kid);
	return { mum, dad, kid };
}

async function openDrawer(page: Page, api: Api, who: Person) {
	await openTree(page, api, who);
	await card(page, who.givenName).dblclick();
	const drawer = page.locator(DRAWER);
	await expect(drawer.getByRole('heading', { name: new RegExp(who.givenName) })).toBeVisible();
	return drawer;
}

test('adds a sibling from the drawer, sharing both recorded parents by default', async ({
	page,
	api
}) => {
	const { kit } = { kit: (await family(api)).kid };
	const drawer = await openDrawer(page, api, kit);

	await drawer.getByTestId('siblings').getByRole('button', { name: '+ Add sibling' }).click();
	const dialog = page.getByRole('dialog', { name: 'Add relationship' });
	const options = dialog.getByTestId('sibling-parents');
	await expect(options.getByRole('radio').first()).toBeChecked();
	await expect(options.getByText('Mona Marsh and Dan Marsh')).toBeVisible();
	// Each parent alone is on offer for a half-sibling.
	await expect(options.getByText('Mona Marsh only')).toBeVisible();

	await dialog.getByRole('button', { name: 'New person' }).click();
	await dialog.getByLabel('Given name').fill('Sunny');
	await expect(
		dialog.getByText(
			/will be recorded as Kit Marsh's sibling and a child of Mona Marsh and Dan Marsh/
		)
	).toBeVisible();
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(dialog).toBeHidden();

	await expect(drawer.getByTestId('siblings').getByText('Sunny')).toBeVisible();
	const graph = await api.graph();
	const sunny = graph.people.find((p) => p.displayName.startsWith('Sunny'))!;
	expect(
		graph.parentChild.filter((l) => l.childId === sunny.id && l.type === 'biological')
	).toHaveLength(2);
});

test('adds a half-sibling through one parent only', async ({ page, api }) => {
	const { kid } = await family(api);
	const drawer = await openDrawer(page, api, kid);
	await drawer.getByTestId('siblings').getByRole('button', { name: '+ Add sibling' }).click();
	const dialog = page.getByRole('dialog', { name: 'Add relationship' });
	await dialog.getByRole('radio', { name: /Dan Marsh only/ }).check();
	await dialog.getByRole('button', { name: 'New person' }).click();
	await dialog.getByLabel('Given name').fill('Half');
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(dialog).toBeHidden();
	const graph = await api.graph();
	const half = graph.people.find((p) => p.displayName.startsWith('Half'))!;
	expect(graph.parentChild.filter((l) => l.childId === half.id).map((l) => l.parentId)).toEqual([
		graph.people.find((p) => p.displayName.startsWith('Dan'))!.id
	]);
	await expect(drawer.getByTestId('siblings').getByText('half-sibling')).toBeVisible();
});

test('a person with no parents is told to add a parent before a sibling', async ({ page, api }) => {
	const loner = await api.addPerson('Lone', 'Ranger');
	await openTree(page, api, loner);
	await card(page, 'Lone').dblclick();
	const drawer = page.locator(DRAWER);
	await drawer.getByTestId('parents').getByRole('button', { name: '+ Add parent' }).click();
	const dialog = page.getByRole('dialog', { name: 'Add relationship' });
	await dialog.getByRole('button', { name: 'Add sibling', exact: true }).click();
	await expect(dialog.getByTestId('sibling-needs-parent')).toBeVisible();
	await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
});

test('adds a child from inside the partnership block', async ({ page, api }) => {
	const { mum } = await family(api);
	const drawer = await openDrawer(page, api, mum);
	await drawer.getByRole('button', { name: '+ Add child' }).click();
	const dialog = page.getByRole('dialog', { name: 'Add relationship' });
	await dialog.getByRole('button', { name: 'New person' }).click();
	await dialog.getByLabel('Given name').fill('Newborn');
	await expect(dialog.getByText(/will be recorded as Mona Marsh's biological child/)).toBeVisible();
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(drawer.getByText('Newborn')).toBeVisible();
});

test('the trash button on a partner asks what happened; "not a partner" previews then removes them', async ({
	page,
	api
}) => {
	const { mum, dad } = await family(api);
	const drawer = await openDrawer(page, api, mum);
	await drawer
		.getByRole('button', { name: /Options for Dan Marsh: record what happened, or remove/ })
		.click();

	const ask = page.getByRole('dialog', { name: /What happened with Dan Marsh/ });
	await expect(ask.getByRole('button', { name: /Divorced or separated/ })).toBeVisible();
	await expect(ask.getByRole('button', { name: /Died/ })).toBeVisible();
	await ask.getByRole('button', { name: /Not a partner/ }).click();

	const confirm = page.getByRole('dialog', { name: /Remove Dan Marsh as a partner/ });
	await expect(confirm.getByText('This is exactly what will change:')).toBeVisible();
	await confirm.getByRole('button', { name: 'Remove partner' }).click();
	await expect(confirm).toBeHidden();

	await expect
		.poll(async () => (await api.graph()).unions.some((u) => u.partnerIds.includes(dad.id)))
		.toBe(false);
	await page.getByRole('button', { name: 'Undo' }).click();
	await expect
		.poll(async () => (await api.graph()).unions.some((u) => u.partnerIds.includes(dad.id)))
		.toBe(true);
});

test('divorce and death from the trash button open the forms already aimed at the right people', async ({
	page,
	api
}) => {
	const { mum } = await family(api);
	const drawer = await openDrawer(page, api, mum);

	await drawer
		.getByRole('button', { name: /Options for Dan Marsh: record what happened, or remove/ })
		.click();
	await page.getByRole('button', { name: /Divorced or separated/ }).click();
	const end = page.getByRole('dialog', { name: 'End partnership' });
	await expect(end.getByLabel('Status')).toHaveValue('divorced');
	await end.getByRole('button', { name: 'Cancel' }).click();

	await drawer
		.getByRole('button', { name: /Options for Dan Marsh: record what happened, or remove/ })
		.click();
	await page.getByRole('button', { name: /^Died/ }).click();
	const death = page.getByRole('dialog', { name: 'Record death' });
	await expect(death.getByText('Dan Marsh')).toBeVisible();
});

test('removing a child from a parent, and a parent from a child, unlinks only that link', async ({
	page,
	api
}) => {
	const { mum, dad, kid } = await family(api);
	const drawer = await openDrawer(page, api, kid);
	await drawer
		.getByTestId('parents')
		.getByRole('button', { name: /Options for Dan Marsh: record what happened, or remove/ })
		.click();
	const ask = page.getByRole('dialog', { name: /What happened with Dan Marsh/ });
	await ask.getByRole('button', { name: /Not related/ }).click();
	const confirm = page.getByRole('dialog', { name: /Remove Dan Marsh as a parent of Kit Marsh/ });
	await confirm.getByRole('button', { name: 'Remove link' }).click();
	await expect(confirm).toBeHidden();
	await expect
		.poll(async () =>
			(await api.graph()).parentChild.filter((l) => l.childId === kid.id).map((l) => l.parentId)
		)
		.toEqual([mum.id]);
	expect((await api.graph()).people.some((p) => p.id === dad.id)).toBe(true);
});
