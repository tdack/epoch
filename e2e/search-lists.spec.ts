import { expect, open, test } from './support';

test('search finds a person by a former name and by place and years, says why, and keeps the query in the URL', async ({
	page,
	api,
	request
}) => {
	const ann = await api.addPerson('Ann', 'Carter', {
		birthDate: '12 JUN 1852',
		birthPlace: 'Cork, Ireland'
	});
	await api.addPerson('Bede', 'Brown', { birthDate: '1900', birthPlace: 'Leeds, England' });
	const res = await request.post(`/api/trees/${api.treeId}/people/${ann.id}/names`, {
		data: { type: 'birth', givenName: 'Ann', surname: 'Brown' }
	});
	expect(res.ok(), await res.text()).toBe(true);

	await open(page, `/trees/${api.treeId}/search`);
	await page.getByTestId('search-q').fill('Ann Brown');
	await page.getByTestId('search-q').press('Enter');
	await expect(page).toHaveURL(/q=Ann\+Brown|q=Ann%20Brown/);
	const results = page.getByTestId('search-results');
	await expect(results.getByTestId('search-result')).toHaveCount(1);
	await expect(results).toContainText('Also known as Ann Brown (birth name)');

	// A refresh keeps the query; place and a year range hold on the same fact.
	await open(page, `/trees/${api.treeId}/search?place=cork&from=1850&to=1855`);
	await expect(page.getByTestId('search-result')).toHaveText('Ann Carter (née Brown)');
	await expect(results).toContainText('Birth: 12 JUN 1852 in Cork, Ireland');
	await open(page, `/trees/${api.treeId}/search?place=cork&from=1900&to=1910`);
	await expect(page.getByTestId('search-empty')).toBeVisible();

	// The form keeps place and years, so a fresh search starts from the bare page.
	await open(page, `/trees/${api.treeId}/search`);
	await page.getByTestId('search-q').fill('Ann Carter');
	await page.getByTestId('search-q').press('Enter');
	await page.getByTestId('search-result').click();
	await expect(page.getByTestId('person-name')).toContainText('Ann Carter');
});

test('the individuals list pages on the server and the surnames list links to it', async ({
	page,
	api
}) => {
	for (let i = 0; i < 53; i++)
		await api.addPerson(`P${String(i).padStart(2, '0')}`, i % 2 ? 'Odd' : 'Even');
	await open(page, `/trees/${api.treeId}/people`);
	const rows = page.getByTestId('people-list').locator('tbody tr');
	await expect(rows).toHaveCount(50);
	await page.getByRole('link', { name: 'Next' }).click();
	await expect(page).toHaveURL(/offset=50/);
	await expect(rows).toHaveCount(3);
	await page.getByRole('link', { name: 'Given name' }).click();
	await expect(page).toHaveURL(/sort=given/);

	await open(page, `/trees/${api.treeId}/surnames`);
	const even = page.getByTestId('surnames-list').getByRole('listitem').filter({ hasText: 'Even' });
	await expect(even).toContainText('27 people');
	await even.getByRole('link', { name: 'Even' }).click();
	await expect(page).toHaveURL(/surname=Even/);
	await expect(page.getByTestId('people-list').locator('tbody tr')).toHaveCount(27);
});

test('the partnerships list shows partners and dates', async ({ page, api }) => {
	const a = await api.addPerson('Tom', 'Smith');
	const b = await api.addPerson('Jessica', 'Simpson');
	await api.partner(a, b);
	await open(page, `/trees/${api.treeId}/unions`);
	await expect(page.getByTestId('unions-list')).toContainText('Tom Smith and Jessica Lovejoy');
});
