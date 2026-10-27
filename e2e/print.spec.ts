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
