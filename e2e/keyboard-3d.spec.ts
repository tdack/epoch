/**
 * The keyboard, menu and drag-to-relate checks of `keyboard.spec.ts` and `controls.spec.ts`, run
 * in both 3D views: the same intents have to mean the same things in all three modes (S16).
 */
import AxeBuilder from '@axe-core/playwright';
import { chooseMenuItem, expect, open, test, type Api } from './support';
import type { Page } from '@playwright/test';

const MODES = ['layers', 'floors'] as const;

/** Homer and Marge, their child Kit, Homer's mother Mum and Homer's sister Sue (a sibling-line card). */
async function family(api: Api) {
	const [homer, marge, kit, mum, dad, sue] = [
		await api.addPerson('Homer', 'Simpson', { birthDate: '1960' }),
		await api.addPerson('Marge', 'Simpson', { birthDate: '1961' }),
		await api.addPerson('Kit', 'Simpson', { birthDate: '1990' }),
		await api.addPerson('Mum', 'Simpson', { birthDate: '1930' }),
		await api.addPerson('Dad', 'Simpson', { birthDate: '1928' }),
		await api.addPerson('Sue', 'Simpson', { birthDate: '1962' })
	];
	await api.partner(homer, marge);
	// Siblings are found through the parents' partnership, so Mum needs one.
	await api.partner(mum, dad);
	await api.child(homer, kit);
	await api.child(mum, homer);
	await api.child(mum, sue);
	return { homer, marge, kit, mum, sue };
}

const card = (page: Page, name: string) =>
	page.locator('[data-person-id]').filter({ hasText: new RegExp(`\\b${name} Simpson`) });

for (const mode of MODES) {
	test.describe(`${mode} view`, () => {
		async function openMode(page: Page, api: Api) {
			const people = await family(api);
			await open(
				page,
				`/trees/${api.treeId}?focus=${encodeURIComponent(people.homer.id)}&up=1&down=1&siblings=1&mode=${mode}`
			);
			await expect(card(page, 'Homer')).toBeVisible();
			await expect(card(page, 'Sue')).toHaveCount(1);
			return people;
		}

		test('arrow keys walk the row and the parent–child links, and Alt+Up and Alt+Down change band', async ({
			page,
			api
		}) => {
			await openMode(page, api);
			await card(page, 'Homer').focus();

			// Which partner stands on the left follows the union's order, so go the way Marge is.
			const homerBox = (await card(page, 'Homer').boundingBox())!;
			const margeBox = (await card(page, 'Marge').boundingBox())!;
			const isMargeRight = margeBox.x > homerBox.x;
			await page.keyboard.press(isMargeRight ? 'ArrowRight' : 'ArrowLeft');
			await expect(card(page, 'Marge')).toBeFocused();
			await page.keyboard.press(isMargeRight ? 'ArrowLeft' : 'ArrowRight');
			await expect(card(page, 'Homer')).toBeFocused();

			await page.keyboard.press('ArrowDown');
			await expect(card(page, 'Kit')).toBeFocused();
			await page.keyboard.press('ArrowUp');
			await expect(page.locator('[data-person-id]:focus')).toHaveAttribute(
				'aria-label',
				/^(Homer|Marge) Simpson/
			);

			await card(page, 'Homer').focus();
			await page.keyboard.press('ArrowUp');
			await expect(card(page, 'Mum')).toBeFocused();

			// Sue stands in the next band back, level with Homer.
			await card(page, 'Homer').focus();
			await page.keyboard.press('Alt+ArrowUp');
			await expect(card(page, 'Sue')).toBeFocused();
			await page.keyboard.press('Alt+ArrowDown');
			await expect(page.locator('[data-person-id]:focus')).toHaveAttribute(
				'aria-label',
				/^(Homer|Marge) Simpson/
			);
			// Only the focus card was in the tab order to start with; moving the cursor moves it.
			await expect(page.locator('[data-person-id][tabindex="0"]')).toHaveCount(1);
		});

		test('Shift+F10 opens the card menu with the editing actions, and Show details opens the drawer', async ({
			page,
			api
		}) => {
			await openMode(page, api);
			await card(page, 'Homer').focus();
			await page.keyboard.press('Shift+F10');
			const menu = page.getByRole('menu');
			await expect(menu).toBeVisible();
			await expect(menu.getByRole('menuitem')).toHaveText([
				'Show details',
				'Edit person',
				'Add relationship',
				'Record death…',
				'End partnership…',
				'Delete person…'
			]);
			// Escape closes it and hands focus back.
			await page.keyboard.press('Escape');
			await expect(menu).toBeHidden();
			await expect(card(page, 'Homer')).toBeFocused();

			await page.keyboard.press('Shift+F10');
			await chooseMenuItem(page, 'Show details');
			await expect(
				page.locator('div.fixed.inset-y-0').getByRole('heading', { name: /Homer Simpson/ })
			).toBeVisible();
		});

		test('Add relationship from the menu records a partner for the card', async ({ page, api }) => {
			const { kit } = await openMode(page, api);
			await card(page, 'Kit').focus();
			await page.keyboard.press('Shift+F10');
			await chooseMenuItem(page, 'Add relationship');
			const dialog = page.getByRole('dialog', { name: 'Add relationship' });
			await dialog.getByRole('button', { name: 'Add partner' }).press('Enter');
			await dialog.getByRole('button', { name: 'New person' }).press('Enter');
			await dialog.getByLabel('Given name').fill('Pat');
			await expect(dialog.getByText("Pat will be recorded as Kit Simpson's partner.")).toBeVisible();
			await dialog.getByRole('button', { name: 'Save', exact: true }).press('Enter');
			await expect(page.getByRole('status').filter({ hasText: 'Pat was recorded' })).toBeVisible();
			const graph = await api.graph();
			expect(graph.unions.some((u) => u.partnerIds.includes(kit.id))).toBe(true);
		});

		test('a partnership node is reachable by Tab and Enter opens its editor', async ({
			page,
			api
		}) => {
			await openMode(page, api);
			await card(page, 'Homer').focus();
			const union = page.locator('[data-union-id][tabindex="0"]');
			for (let i = 0; i < 6 && !(await union.evaluate((el) => el === document.activeElement)); i++)
				await page.keyboard.press('Tab');
			await expect(union).toBeFocused();
			await page.keyboard.press('Enter');
			await expect(page.getByRole('dialog', { name: 'Edit partnership' })).toBeVisible();
		});

		test('dragging one card onto another opens Add relationship for the pair', async ({
			page,
			api
		}) => {
			await openMode(page, api);
			const from = (await card(page, 'Homer').locator('.frame').first().boundingBox())!;
			const to = (await card(page, 'Marge').locator('.frame').first().boundingBox())!;
			await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
			await page.mouse.down();
			await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
			await page.mouse.up();
			await expect(page.getByRole('dialog', { name: 'Add relationship' })).toBeVisible();
		});

		test('a card says which band it belongs to, and each plane or floor is a labelled group', async ({
			page,
			api
		}) => {
			await openMode(page, api);
			await expect(card(page, 'Sue')).toHaveAttribute('aria-label', /sibling line/);
			await expect(card(page, 'Homer')).toHaveAttribute('aria-label', /focus person/);
			const canvas = page.getByRole('application', { name: `Family tree, ${mode} view` });
			await expect(canvas.getByRole('group').first()).toBeVisible();
			// The Preview badge came off with this stage.
			await expect(canvas.getByText('Preview', { exact: true })).toHaveCount(0);
		});

		test('the view has no automatically detectable accessibility violations', async ({
			page,
			api
		}) => {
			await openMode(page, api);
			const result = await new AxeBuilder({ page })
				.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
				.analyze();
			expect(
				result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length}) ${v.nodes[0]?.target}`)
			).toEqual([]);
		});
	});
}
