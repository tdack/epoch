/**
 * What keeps the 3D views workable on a big tree and on a phone (S16 stage 7): crowded back rows
 * fold into a "+N" mark, planes out of view draw no cards, and a narrow screen gets one plane at a
 * time (Layers) or the hourglass with a note (Floors).
 */
import { expect, open, test, type Api } from './support';
import type { Page } from '@playwright/test';

const SIBLINGS = 13;

/** Homer with a crowd of siblings, a partner and a child, and parents above. */
async function crowd(api: Api) {
	const homer = await api.addPerson('Homer', 'Crowd', { birthDate: '1960' });
	const marge = await api.addPerson('Marge', 'Crowd', { birthDate: '1961' });
	const mum = await api.addPerson('Mum', 'Crowd', { birthDate: '1930' });
	const dad = await api.addPerson('Dad', 'Crowd', { birthDate: '1928' });
	const kit = await api.addPerson('Kit', 'Crowd', { birthDate: '1990' });
	await api.partner(homer, marge);
	await api.partner(mum, dad);
	await api.child(mum, homer);
	await api.child(homer, kit);
	for (let i = 0; i < SIBLINGS; i++) {
		const sibling = await api.addPerson(`Sib${String(i).padStart(2, '0')}`, 'Crowd', {
			birthDate: String(1950 + i)
		});
		await api.child(mum, sibling);
	}
	return { homer };
}

const cards = (page: Page) => page.locator('[data-person-id]');

for (const mode of ['layers', 'floors'] as const) {
	test(`${mode}: a crowded back row folds into a mark that opens it`, async ({ page, api }) => {
		const { homer } = await crowd(api);
		await open(
			page,
			`/trees/${api.treeId}?focus=${encodeURIComponent(homer.id)}&up=1&down=1&siblings=1&mode=${mode}`
		);
		await expect(cards(page).filter({ hasText: /Homer Crowd/ })).toBeVisible();

		const fold = page.locator('[data-fold-id]').first();
		await expect(fold).toBeAttached();
		await expect(fold).toHaveAttribute('aria-label', /Show \d+ more people on the sibling line/);
		const shown = await cards(page)
			.filter({ hasText: /Sib\d+ Crowd/ })
			.count();
		expect(shown).toBeLessThan(SIBLINGS);

		// The focus person and their direct line are never folded.
		await expect(cards(page).filter({ hasText: /Marge Crowd|Mum Crowd|Kit Crowd/ })).toHaveCount(3);

		const url = page.url();
		await fold.focus();
		await page.keyboard.press('Enter');
		await expect(page.locator('[data-fold-id]')).toHaveCount(0);
		await expect(cards(page).filter({ hasText: /Sib\d+ Crowd/ })).toHaveCount(SIBLINGS);
		// Folding is a view choice, so it never reaches the address.
		expect(page.url()).toBe(url);
	});
}

test('floors: floors out of view draw no cards, and Fit brings them back', async ({
	page,
	api
}) => {
	const a = await api.addPerson('Gen0', 'Deep');
	const people = [a];
	for (let i = 1; i <= 4; i++) {
		const child = await api.addPerson(`Gen${i}`, 'Deep');
		await api.child(people[i - 1], child);
		people.push(child);
	}
	await open(
		page,
		`/trees/${api.treeId}?focus=${encodeURIComponent(people[2].id)}&up=2&down=2&mode=floors`
	);
	const all = page.locator('[data-person-id]');
	await expect(all).toHaveCount(5);

	const canvas = page.getByRole('application', { name: 'Family tree, floors view' });
	for (let i = 0; i < 6; i++) await canvas.getByRole('button', { name: 'Zoom in' }).click();
	// Zoomed far in on the focus floor, the outer floors are off the canvas and are not drawn.
	await expect.poll(async () => await all.count()).toBeLessThan(5);
	await expect(all.filter({ hasText: /Gen2 Deep/ })).toHaveCount(1);

	await canvas.getByRole('button', { name: /Fit/ }).click();
	await expect(all).toHaveCount(5);
});

test.describe('on a phone', () => {
	test.use({ viewport: { width: 390, height: 780 } });

	test('layers shows one plane at a time with tabs, and floors falls back to the hourglass with a note', async ({
		page,
		api
	}) => {
		const { homer } = await crowd(api);
		const base = `/trees/${api.treeId}?focus=${encodeURIComponent(homer.id)}&up=1&down=1&siblings=1`;

		await open(page, `${base}&mode=layers`);
		const canvas = page.getByRole('application', { name: 'Family tree, layers view' });
		await expect(canvas).toBeVisible();
		const tabs = canvas.getByRole('group', { name: 'Plane' });
		await expect(tabs.getByRole('button', { name: 'Union' })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		await expect(canvas.getByRole('group', { name: 'Camera' })).toHaveCount(0);
		await expect(page.getByRole('group', { name: 'The union and its descendants' })).toBeVisible();
		await expect(page.getByRole('group', { name: 'The families it came from' })).toHaveCount(0);
		await tabs.getByRole('button', { name: 'Families' }).click();
		await expect(page.getByRole('group', { name: 'The families it came from' })).toBeVisible();
		await expect(page.getByRole('group', { name: 'The union and its descendants' })).toHaveCount(0);

		await open(page, `${base}&mode=floors`);
		await expect(page.getByRole('note')).toHaveText(/Floors needs a wider screen/);
		await expect(page.getByRole('application', { name: 'Family tree', exact: true })).toBeVisible();
		await expect(page.getByRole('application', { name: 'Family tree, floors view' })).toHaveCount(
			0
		);
	});
});
