import { expect, open, test } from './support';

const SHOTS = process.env.E2E_SHOTS ?? 'test-results';

test('two cousins are related through their grandparent, and the question lives in the address', async ({
	api,
	page
}) => {
	const gran = await api.addPerson('Granny', 'Pedigree', { birthDate: '1850', deathDate: '1920' });
	const dad = await api.addPerson('Dadly', 'Pedigree', { birthDate: '1880', deathDate: '1950' });
	const unc = await api.addPerson('Uncly', 'Pedigree', { birthDate: '1882', deathDate: '1960' });
	const mine = await api.addPerson('Minnie', 'Pedigree', { birthDate: '1910', deathDate: '1990' });
	const theirs = await api.addPerson('Theodore', 'Pedigree', {
		birthDate: '1912',
		deathDate: '1992'
	});
	await api.child(gran, dad);
	await api.child(gran, unc);
	await api.child(dad, mine);
	await api.child(unc, theirs);

	await open(page, `/trees/${api.treeId}/relationship`);
	await page.getByLabel('First person').fill('Minnie');
	await page.getByRole('option', { name: /Minnie Pedigree/ }).click();
	await page.getByLabel('Second person').fill('Theodore');
	await page.getByRole('option', { name: /Theodore Pedigree/ }).click();

	await expect(page).toHaveURL(/relationship\?from=.+&to=.+/);
	await expect(page.getByTestId('route')).toHaveCount(1);
	await expect(page.getByTestId('route-label')).toHaveText(
		"Theodore Pedigree is Minnie Pedigree's 1st cousin."
	);
	await expect(page.getByLabel('Steps').getByRole('link')).toHaveCount(5);
	await page.screenshot({ path: `${SHOTS}/relationship-cousins.png` });

	// A refresh keeps the question and the answer.
	await page.reload();
	await expect(page.getByTestId('route-label')).toContainText('1st cousin');
	await expect(page.getByTestId('picked-first person')).toHaveText('Minnie Pedigree');

	// Unrelated people say so.
	const stranger = await api.addPerson('Strange', 'Elsewhere', {
		birthDate: '1900',
		deathDate: '1970'
	});
	await open(
		page,
		`/trees/${api.treeId}/relationship?from=${encodeURIComponent(mine.id)}&to=${encodeURIComponent(stranger.id)}`
	);
	await expect(page.getByTestId('no-relationship')).toContainText('No relationship');
});
