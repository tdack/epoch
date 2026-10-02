import { card, expect, openTree, test } from './support';

test('Back undoes a burst of depth clicks in one step, and returns to the previous person', async ({
	page,
	api
}) => {
	const [a, b] = [await api.addPerson('Ann'), await api.addPerson('Ben')];
	await api.child(a, b);
	await openTree(page, api, a);
	const url = () => new URL(page.url());

	// Two quick clicks on the stepper make one history entry, not two.
	await page.getByRole('button', { name: 'Fewer ancestors generations' }).click();
	await page.getByRole('button', { name: 'Fewer ancestors generations' }).click();
	await expect.poll(() => url().searchParams.get('up')).toBe('1');
	await page.goBack();
	await expect.poll(() => url().searchParams.get('up')).toBeNull();

	// Choosing another person pushes an entry that Back leaves again.
	await card(page, 'Ben').click();
	await expect.poll(() => url().searchParams.get('focus')).toBe(b.id);
	await page.goBack();
	await expect.poll(() => url().searchParams.get('focus')).toBe(a.id);
});

test('opened stubs are kept in the URL and survive a reload', async ({ page, api }) => {
	// Five generations of ancestors; the default depth of three leaves a "+1" stub above the third.
	const chain = [await api.addPerson('Gen0')];
	for (const n of [1, 2, 3, 4]) {
		const parent = await api.addPerson(`Gen${n}`);
		await api.parent(chain[n - 1], parent);
		chain.push(parent);
	}
	await openTree(page, api, chain[0]);
	await expect(card(page, 'Gen4')).toHaveCount(0);

	await page.getByRole('button', { name: /Show 1 more parent/ }).click();
	await expect(card(page, 'Gen4')).toBeVisible();
	const exp = new URL(page.url()).searchParams.get('exp');
	expect(exp).toMatch(/^a\.[0-9a-z]{1,7}$/);

	await page.reload();
	await expect(card(page, 'Gen4')).toBeVisible();
});
