/**
 * Colour settings (ADR-054): a person's own male colour repaints the flat view's cards. Settings
 * belong to the dev user, not the spec's tree, so the spec puts them back whatever happens.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, open, test } from './support';

test('changing the male colour repaints the flat card border', async ({ api, page, request }) => {
	// The focus card is framed in ink, so the colour is read off a relative's card.
	const jane = await api.addPerson('Jane', 'Colours', { sex: 'F' });
	const john = await api.addPerson('John', 'Colours', { sex: 'M' });
	await api.child(jane, john);
	const tree = `/trees/${api.treeSlug}`;
	const canvas = page.getByRole('application', { name: 'Family tree', exact: true });
	const borderVariable = () =>
		canvas.evaluate((element) =>
			(element as HTMLElement).style.getPropertyValue('--sex-m-border').trim()
		);

	try {
		await open(page, `${tree}?focus=${encodeURIComponent(jane.id)}&mode=flat`);
		await expect(canvas).toBeVisible();
		expect(await borderVariable()).not.toBe('#3a6ea5');

		await open(page, '/account#appearance');
		const male = page.getByRole('textbox', { name: 'Male', exact: true }).first();
		await male.fill('#3a6ea5');
		await page.getByRole('button', { name: 'Save colours' }).first().click();
		await expect(page.getByRole('status').filter({ hasText: 'Saved.' }).first()).toBeVisible();

		await open(page, `${tree}?focus=${encodeURIComponent(jane.id)}&mode=flat`);
		await expect.poll(borderVariable).toBe('#3a6ea5');
		const stroke = await page
			.locator(`[data-person-id="${john.id}"] rect.frame`)
			.first()
			.evaluate((element) => getComputedStyle(element).stroke);
		expect(stroke).toBe('rgb(58, 110, 165)');
	} finally {
		const reset = await request.put('/api/settings', { data: { sexColours: null } });
		expect(reset.ok()).toBe(true);
	}
});

test('the account page has no detectable accessibility violations, even with an error shown', async ({
	page
}) => {
	await open(page, '/account');
	await page.getByRole('textbox', { name: 'Female', exact: true }).first().fill('pink');
	const result = await new AxeBuilder({ page })
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
		.analyze();
	expect(
		result.violations.map((v) => `${v.id}: ${v.help} ${v.nodes[0]?.target?.join(' ')}`)
	).toEqual([]);
});
