import { expect, open, test } from './support';

const SHOTS = process.env.E2E_SHOTS ?? 'test-results';

test('places are listed once however their case varies, open onto their facts, and are suggested while typing', async ({ api, page }) => {
	const one = await api.addPerson('Corky', 'Placed', { birthDate: '1850', birthPlace: 'Cork, Ireland', deathDate: '1920', deathPlace: 'Hobart' });
	await api.addPerson('Corkette', 'Placed', { birthDate: '1852', birthPlace: 'cork, ireland', deathDate: '1925' });

	await open(page, `/trees/${api.treeId}/places`);
	await expect(page.getByTestId('places-list').getByRole('listitem')).toHaveCount(2);
	const cork = page.getByRole('listitem').filter({ hasText: 'Cork, Ireland' });
	await expect(cork).toContainText('2 facts, 2 people');
	await page.screenshot({ path: `${SHOTS}/places.png` });

	await page.getByLabel('Find a place').fill('hobart');
	await page.getByRole('button', { name: 'Find' }).click();
	await expect(page.getByTestId('places-list').getByRole('listitem')).toHaveCount(1);
	await page.getByRole('link', { name: 'Hobart' }).click();
	await expect(page.getByTestId('place-name')).toHaveText('Hobart');
	await expect(page.getByTestId('place-facts')).toContainText('Death of Corky Placed');

	await open(page, `/trees/${api.treeId}/places`);
	await page.getByRole('link', { name: 'Cork, Ireland' }).click();
	await expect(page.getByTestId('place-facts').getByRole('listitem')).toHaveCount(2);
	await page.screenshot({ path: `${SHOTS}/place.png` });

	// The person page links its facts to the place, and the editor suggests places already used.
	await open(page, `/trees/${api.treeId}/people/${encodeURIComponent(one.id)}`);
	await page.getByRole('link', { name: 'Cork, Ireland' }).click();
	await expect(page.getByTestId('place-name')).toHaveText('Cork, Ireland');
	await open(page, `/trees/${api.treeId}/people/${encodeURIComponent(one.id)}`);
	await page.getByRole('button', { name: 'Add fact' }).click();
	await page.getByRole('dialog', { name: 'Add a fact' }).getByLabel('Place').fill('cork');
	await expect(page.locator('#fact-place-options option')).toHaveCount(1);
	await expect(page.locator('#fact-place-options option').first()).toHaveAttribute('value', 'Cork, Ireland');
});

test('a place is renamed, merged into another and put back with one undo each', async ({ api, page }) => {
	await api.addPerson('Renny', 'Placed', { birthDate: '1850', birthPlace: 'Corke' });
	await api.addPerson('Merry', 'Placed', { birthDate: '1852', birthPlace: 'Cork' });

	await open(page, `/trees/${api.treeId}/place?name=Corke`);
	await page.getByTestId('rename-place').click();
	const dialog = page.getByRole('dialog', { name: 'Rename or merge this place' });
	await dialog.getByLabel('Name on every fact at this place').fill('Cork');
	await expect(dialog).toContainText('Birth of Renny Placed');
	await page.screenshot({ path: `${SHOTS}/place-merge.png` });
	await dialog.getByRole('button', { name: 'Change place' }).click();

	// Merging moved the facts, and the address with them.
	await expect(page).toHaveURL(/name=Cork$/);
	await expect(page.getByTestId('place-facts').getByRole('listitem')).toHaveCount(2);

	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(page).toHaveURL(/name=Corke$/);
	await expect(page.getByTestId('place-facts').getByRole('listitem')).toHaveCount(1);
});
