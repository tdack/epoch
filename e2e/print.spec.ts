import { expect, open, test } from './support';

test('a printed person page drops the app chrome and says whose view it is', async ({
	page,
	api
}) => {
	const wren = await api.addPerson('Wren', 'Ash', { birthDate: 'ABT 1900', birthPlace: 'Leeds' });
	await open(page, `/trees/${api.treeSlug}/people/${encodeURIComponent(wren.id)}`);
	await page.emulateMedia({ media: 'print' });

	await expect(page.getByRole('heading', { name: 'Wren Ash', level: 1 })).toBeVisible();
	await expect(page.getByText('about 1900').first()).toBeVisible();
	await expect(page.getByRole('navigation', { name: /tree/i })).toBeHidden();
	await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeHidden();
	await expect(page.getByTestId('print-footer')).toBeVisible();

	// The print dialog opens every folded disclosure, and closing it folds them again.
	const folded = page.locator('main details:not([open])');
	const before = await folded.count();
	await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
	await expect(folded).toHaveCount(0);
	await expect(page.getByTestId('print-footer')).toContainText(/printed \d+ \w+ \d{4}/);
	await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
	await expect(folded).toHaveCount(before);
});

test('a printed partnership page reads as a family group sheet', async ({ page, api }) => {
	const ann = await api.addPerson('Ann', 'Fox');
	const bob = await api.addPerson('Bob', 'Fox');
	const kit = await api.addPerson('Kit', 'Fox');
	await api.partner(ann, bob);
	await api.child(ann, kit);
	const [union] = (await api.graph()).unions;
	await open(page, `/trees/${api.treeSlug}/unions/${encodeURIComponent(union.id)}`);
	await page.emulateMedia({ media: 'print' });

	await expect(page.getByRole('heading', { name: 'Children' })).toBeVisible();
	await expect(page.getByTestId('union-children').getByText('Kit Fox')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'History' })).toBeHidden();
	await expect(page.getByRole('heading', { name: 'Warnings' })).toBeHidden();
	await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeHidden();
});

test('a printed chart keeps its drawing and drops its controls', async ({ page, api }) => {
	const ann = await api.addPerson('Ann', 'Fox');
	const kit = await api.addPerson('Kit', 'Fox');
	await api.parent(kit, ann);
	await open(page, `/trees/${api.treeSlug}/people/${encodeURIComponent(kit.id)}/pedigree`);
	await page.emulateMedia({ media: 'print' });

	await expect(page.getByRole('group', { name: /ancestors/i }).first()).toBeVisible();
	await expect(page.getByRole('navigation', { name: 'Chart style' })).toBeHidden();
	await expect(page.getByRole('link', { name: 'More generations' })).toBeHidden();
	await expect(page.getByTestId('print-footer')).toBeVisible();
});

test('a printed tree canvas points to a chart instead', async ({ page, api }) => {
	await api.addPerson('Ann', 'Fox');
	await open(page, `/trees/${api.treeSlug}`);
	await page.emulateMedia({ media: 'print' });
	await expect(page.getByTestId('print-note')).toBeVisible();
});
