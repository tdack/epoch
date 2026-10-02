import { expect, open, test } from './support';

test('favourites and recents survive a reload, are offered in the focus box before typing, and are scoped to the tree', async ({
	page,
	api
}) => {
	const ann = await api.addPerson('Ann', 'Brown');
	const bede = await api.addPerson('Bede', 'Cole');
	const other = await api.addPerson('Cora', 'Dunn');

	// Opening a person is what records a recent; favouriting is a toggle.
	await open(page, `/trees/${api.treeId}/people/${encodeURIComponent(ann.id)}`);
	await page.getByTestId('favorite-toggle').click();
	await expect(page.getByTestId('favorite-toggle')).toHaveAttribute('aria-pressed', 'true');
	await open(page, `/trees/${api.treeId}/people/${encodeURIComponent(bede.id)}`);
	await expect(page.getByTestId('marks-strip')).toContainText('Bede Cole');

	await page.reload();
	await page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
	const strip = page.getByTestId('marks-strip');
	await expect(strip.getByRole('navigation', { name: 'Favourites' })).toContainText('Ann Brown');
	await expect(strip.getByRole('navigation', { name: 'Recent people' })).toContainText('Bede Cole');

	// The focus box offers both before anything is typed.
	await open(page, `/trees/${api.treeId}?focus=${encodeURIComponent(other.id)}`);
	await page.getByLabel('Focus on a person').focus();
	const options = page.getByRole('listbox', { name: 'People' }).getByRole('option');
	await expect(options.filter({ hasText: 'Ann Brown' })).toContainText('Favourite');
	await expect(options.filter({ hasText: 'Bede Cole' })).toContainText('Recent');

	// Removing the favourite takes it out of the strip; another tree never shows this tree's marks.
	await open(page, `/trees/${api.treeId}/people/${encodeURIComponent(ann.id)}`);
	await page.getByTestId('favorite-toggle').click();
	await expect(page.getByTestId('favorite-toggle')).toHaveAttribute('aria-pressed', 'false');
	await expect(page.getByRole('navigation', { name: 'Favourites' })).toHaveCount(0);
});
