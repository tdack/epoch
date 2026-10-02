import { expect, open, test } from './support';

const SHOTS = process.env.E2E_SHOTS ?? 'test-results';

test('the pedigree and descendant charts draw the family, and follow a card', async ({ api, page }) => {
	const gran = await api.addPerson('Granny', 'Chartly', { birthDate: '1850', deathDate: '1920' });
	const gramp = await api.addPerson('Grampy', 'Chartly', { birthDate: '1848', deathDate: '1919' });
	const dad = await api.addPerson('Dadly', 'Chartly', { birthDate: '1880', deathDate: '1950' });
	const mum = await api.addPerson('Mumly', 'Chartly', { birthDate: '1884', deathDate: '1960' });
	const me = await api.addPerson('Minnie', 'Chartly', { birthDate: '1910', deathDate: '1990' });
	const sib = await api.addPerson('Sibley', 'Chartly', { birthDate: '1912', deathDate: '1992' });
	await api.child(gran, dad);
	await api.child(gramp, dad);
	await api.child(dad, me);
	await api.child(mum, me);
	await api.child(dad, sib);

	await open(page, `/trees/${api.treeId}/people/${encodeURIComponent(me.id)}/pedigree`);
	await expect(page.getByRole('heading', { name: 'Ancestors of Minnie Chartly' })).toBeVisible();
	await expect(page.getByTestId('generations')).toHaveText('4');
	await expect(page.getByTestId('chart-card')).toHaveCount(5);
	await page.screenshot({ path: `${SHOTS}/pedigree.png` });

	// A card leads to the chart of that person.
	await page.getByRole('link', { name: /Dadly Chartly/ }).click();
	await expect(page.getByRole('heading', { name: 'Ancestors of Dadly Chartly' })).toBeVisible();
	await expect(page.getByTestId('chart-card')).toHaveCount(3);

	// One generation is only the person; the control is a link, so the depth is in the address.
	await page.getByRole('link', { name: 'Fewer generations' }).click();
	await expect(page).toHaveURL(/generations=3/);
	await page.goto(`/trees/${api.treeId}/people/${encodeURIComponent(me.id)}/pedigree?generations=2`);
	await expect(page.getByTestId('chart-card')).toHaveCount(3);
	await expect(page.getByTestId('more')).toContainText('Further ancestors');

	await open(page, `/trees/${api.treeId}/people/${encodeURIComponent(dad.id)}/descendants`);
	await expect(page.getByRole('heading', { name: 'Descendants of Dadly Chartly' })).toBeVisible();
	await expect(page.getByTestId('chart-card')).toHaveCount(3);
	await page.screenshot({ path: `${SHOTS}/descendants.png` });

	// The person page links to both.
	await open(page, `/trees/${api.treeId}/people/${encodeURIComponent(me.id)}`);
	await page.getByRole('link', { name: 'Ancestors', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Ancestors of Minnie Chartly' })).toBeVisible();
});
