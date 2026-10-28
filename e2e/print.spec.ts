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

test('a printed 3D view points to a chart instead', async ({ page, api }) => {
	await api.addPerson('Ann', 'Fox');
	await open(page, `/trees/${api.treeSlug}?mode=rings`);
	await page.emulateMedia({ media: 'print' });
	await expect(page.getByTestId('print-note')).toBeVisible();
});

test('the family group sheet and a narrative print as plain documents', async ({ page, api }) => {
	const ann = await api.addPerson('Ann', 'Fox', { birthDate: '1900', birthPlace: 'Leeds' });
	const bob = await api.addPerson('Bob', 'Fox');
	const kit = await api.addPerson('Kit', 'Fox', { birthDate: '1930' });
	await api.partner(ann, bob);
	await api.child(ann, kit);
	const [union] = (await api.graph()).unions;

	await open(page, `/trees/${api.treeSlug}/unions/${encodeURIComponent(union.id)}/sheet`);
	await page.emulateMedia({ media: 'print' });
	await expect(page.getByRole('heading', { name: 'Partner 1' })).toBeVisible();
	await expect(page.getByRole('table').getByText('Kit Fox')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Print' })).toBeHidden();
	await expect(page.getByTestId('print-footer')).toBeVisible();

	await open(
		page,
		`/trees/${api.treeSlug}/people/${encodeURIComponent(ann.id)}/narrative?generations=2`
	);
	await expect(page.getByRole('heading', { name: 'Generation 2' })).toBeVisible();
	await expect(page.getByRole('article').filter({ hasText: 'Kit Fox' }).last()).toBeVisible();
	await expect(page.getByRole('button', { name: 'Print' })).toBeHidden();
});

test('the calendar prints one month and drops its controls', async ({ page, api }) => {
	await api.addPerson('Ann', 'Fox', { birthDate: '12 MAY 1900' });
	await open(page, `/trees/${api.treeSlug}/calendar?month=5`);
	await page.emulateMedia({ media: 'print' });

	await expect(page.getByRole('heading', { name: 'Calendar', level: 1 })).toBeVisible();
	await expect(page.getByRole('table').getByText('Ann Fox born')).toBeVisible();
	await expect(page.getByLabel('Month')).toBeHidden();
	await expect(page.getByRole('button', { name: 'Download CSV' })).toBeHidden();
	await expect(page.getByTestId('print-footer')).toBeVisible();
});

test('the flat tree prints alone on one sheet cut to the drawing', async ({ page, api }) => {
	const ann = await api.addPerson('Ann', 'Fox');
	const bob = await api.addPerson('Bob', 'Fox');
	const kit = await api.addPerson('Kit', 'Fox');
	await api.partner(ann, bob);
	await api.child(ann, kit);
	await open(page, `/trees/${api.treeSlug}?focus=${encodeURIComponent(kit.id)}&mode=flat`);
	await expect(page.getByRole('button', { name: /Print as a poster/ })).toBeVisible();

	await page.emulateMedia({ media: 'print' });
	await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
	const poster = page.locator('body > [data-tree-poster]');
	await expect(poster.getByText('Kit Fox', { exact: true })).toBeVisible();
	await expect(page.getByTestId('print-note')).toBeHidden();

	// A small family stays on one sheet no smaller than A4 landscape.
	const pdf = (await page.pdf({ preferCSSPageSize: true })).toString('latin1');
	expect(pdf.match(/\/Type\s*\/Page\b/g)).toHaveLength(1);
	const [, width, height] = pdf.match(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)/)!;
	expect(Math.round(Number(width) / 2.8346)).toBe(297);
	expect(Math.round(Number(height) / 2.8346)).toBe(210);

	await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
	await expect(poster).toHaveCount(0);
});
