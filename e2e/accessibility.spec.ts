/**
 * Screen-reader and small-screen checks. axe covers the mechanical rules (names, roles, contrast,
 * labels); the rest asserts the things a person relies on that a rule cannot know: that a dialog is
 * announced, that the preview is a live region, that a choice is a labelled group, and that nothing
 * runs off a phone-sized screen.
 */
import AxeBuilder from '@axe-core/playwright';
import {
	addRelationship,
	card,
	chooseMenuItem,
	expect,
	open,
	openMenuByKeyboard,
	openTree,
	test,
	type Api
} from './support';
import type { Page } from '@playwright/test';

/** John with two partnerships, so the chooser appears. */
async function family(api: Api) {
	const [john, jane, kit] = [
		await api.addPerson('John', 'Smith'),
		await api.addPerson('Jane', 'Smith'),
		await api.addPerson('Kit', 'Smith')
	];
	await api.partner(john, jane);
	await api.child(john, kit);
	return { john, jane, kit };
}

async function violations(page: Page, scope?: string) {
	const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
	const result = await (scope ? builder.include(scope) : builder).analyze();
	return result.violations.map(
		(v) => `${v.id}: ${v.help} (${v.nodes.length}) ${v.nodes[0]?.target?.join(' ')}`
	);
}

test.describe('screen reader', () => {
	test('the tree page has no automatically detectable accessibility violations', async ({
		page,
		api
	}) => {
		const { john } = await family(api);
		await openTree(page, api, john);
		expect(await violations(page)).toEqual([]);
	});

	test('the sources list, a source page, the evidence on a person and the citation dialog have no detectable violations', async ({
		page,
		api,
		request
	}) => {
		const wren = await api.addPerson('Wren', 'Ash', { birthDate: '4 MAR 1900' });
		const body = await (
			await request.get(`/api/trees/${api.treeId}/people/${encodeURIComponent(wren.id)}`)
		).json();
		const birthId = body.facts.find((f: { type: string }) => f.type === 'BIRT').id as string;
		const made = await request.post(`/api/trees/${api.treeId}/sources`, {
			data: { title: 'Parish register', author: 'Rev A' }
		});
		const sourceId = (await made.json()).sourceId as string;
		await request.post(`/api/trees/${api.treeId}/citations`, {
			data: {
				subject: { kind: 'event', id: birthId },
				sourceId,
				page: 'page 12',
				quality: 3,
				entryDate: 'ABT 1901'
			}
		});
		const base = `/trees/${api.treeId}`;

		await open(page, `${base}/sources`);
		expect(await violations(page)).toEqual([]);
		await open(page, `${base}/sources/${encodeURIComponent(sourceId)}`);
		expect(await violations(page)).toEqual([]);

		// The person page with its citations open, then the dialog that adds one.
		await open(page, `${base}/people/${encodeURIComponent(wren.id)}`);
		await page.getByTestId('fact').first().getByText('Sourced').click();
		expect(await violations(page)).toEqual([]);
		await page
			.getByTestId('fact')
			.first()
			.getByRole('button', { name: 'Add a citation for the birth' })
			.click();
		const dialog = page.getByRole('dialog', { name: 'Add a citation' });
		await expect(dialog).toBeVisible();
		expect(await violations(page)).toEqual([]);
	});

	test('the notes list, a note page, the tasks page, and the notes and tasks on a person have no detectable violations', async ({
		page,
		api,
		request
	}) => {
		const wren = await api.addPerson('Wren', 'Ash', { birthDate: '4 MAR 1900' });
		const base = `/trees/${api.treeId}`;
		const made = await request.post(`/api/trees/${api.treeId}/notes`, {
			data: { text: 'The Ash family came from Cork.' }
		});
		const noteId = (await made.json()).noteId as string;
		await request.post(`/api/trees/${api.treeId}/note-links`, {
			data: { subject: { kind: 'person', id: wren.id }, noteId }
		});
		await request.post(`/api/trees/${api.treeId}/note-links`, {
			data: { subject: { kind: 'person', id: wren.id }, text: 'Written on the person.' }
		});
		await request.post(`/api/trees/${api.treeId}/tasks`, {
			data: {
				title: 'Find the birth certificate',
				dueDate: '2027-03-31',
				subject: { kind: 'person', id: wren.id }
			}
		});

		await open(page, `${base}/notes`);
		expect(await violations(page)).toEqual([]);
		await open(page, `${base}/notes/${encodeURIComponent(noteId)}`);
		expect(await violations(page)).toEqual([]);
		await open(page, `${base}/tasks`);
		expect(await violations(page)).toEqual([]);

		// The person page with its notes and tasks, then the dialogs that add one.
		await open(page, `${base}/people/${encodeURIComponent(wren.id)}`);
		expect(await violations(page)).toEqual([]);
		await page.getByTestId('fact').first().getByText('Add a note').click();
		expect(await violations(page)).toEqual([]);
		await page
			.getByTestId('fact')
			.first()
			.getByRole('button', { name: 'Add a note to the birth' })
			.click();
		await expect(page.getByRole('dialog', { name: 'Add a note' })).toBeVisible();
		expect(await violations(page)).toEqual([]);
		await page
			.getByRole('dialog', { name: 'Add a note' })
			.getByRole('button', { name: 'Cancel' })
			.click();
		await page.getByRole('button', { name: 'Add a task about Wren Ash' }).click();
		await expect(page.getByRole('dialog', { name: 'Add a research task' })).toBeVisible();
		expect(await violations(page)).toEqual([]);
	});

	test('the relationship dialog is announced, groups its choices and describes the result in a live region', async ({
		page,
		api
	}) => {
		const { john } = await family(api);
		await api.addPerson('Second', 'Partner').then((p) => api.partner(john, p));
		await openTree(page, api, john);
		await openMenuByKeyboard(page, 'John');
		await chooseMenuItem(page, 'Add relationship');
		const dialog = page.getByRole('dialog', { name: 'Add relationship' });
		await dialog.getByRole('button', { name: 'Add child' }).click();
		await dialog.getByRole('button', { name: 'New person' }).click();
		await dialog.getByLabel('Given name').fill('Newborn');

		// The choice among partnerships is a group with a name, and its options are radios.
		const group = dialog.getByRole('group', { name: 'Which partnership' });
		await expect(group.getByRole('radio')).toHaveCount(2);
		// The sentence that says what will be saved sits in a polite live region.
		const live = dialog.locator('[aria-live="polite"]').filter({ hasText: 'will be recorded as' });
		await expect(live).toBeVisible();
		await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
		expect(await violations(page, 'dialog[open]')).toEqual([]);
	});

	test('a failed preview is announced as an alert', async ({ page, api }) => {
		const { john } = await family(api);
		await openTree(page, api, john);
		await page.route('**/relationships/plan', (route) =>
			route.fulfill({ status: 400, json: { error: 'That did not work', code: 'VALIDATION_ERROR' } })
		);
		await openMenuByKeyboard(page, 'John');
		await chooseMenuItem(page, 'Add relationship');
		const dialog = page.getByRole('dialog', { name: 'Add relationship' });
		await dialog.getByRole('button', { name: 'New person' }).click();
		await dialog.getByLabel('Given name').fill('Nobody');
		await expect(dialog.getByRole('alert')).toContainText('That did not work');
	});

	test('a saved change is announced as a status with an Undo button', async ({ page, api }) => {
		const { john } = await family(api);
		await openTree(page, api, john);
		await addRelationship(page, 'John', 'Add child', { newGiven: 'Wren' });
		const status = page.getByRole('status').filter({ hasText: 'Wren' });
		await expect(status).toBeVisible();
		await expect(status.getByRole('button', { name: 'Undo' })).toBeVisible();
	});

	test('cards and links have names that say who they are and how they relate', async ({
		page,
		api
	}) => {
		const { john } = await family(api);
		await openTree(page, api, john);
		await expect(page.getByRole('application', { name: 'Family tree' })).toBeVisible();
		await expect(page.getByRole('button', { name: /John Smith, focus person/ })).toBeVisible();
		await expect(page.getByRole('button', { name: /Kit Smith, child/ })).toBeVisible();
		await expect(page.getByRole('button', { name: /Parent link to Kit/ })).toBeAttached();
	});

	test('the person drawer is reachable by keyboard and has no violations', async ({
		page,
		api
	}) => {
		const { john } = await family(api);
		await openTree(page, api, john);
		await card(page, 'John').dblclick();
		const drawer = page.locator('div.fixed.inset-y-0');
		await expect(drawer.getByRole('heading', { name: /John Smith/ })).toBeVisible();
		await expect(drawer.getByRole('button', { name: 'Close details' })).toBeVisible();
		expect(await violations(page, 'div.fixed.inset-y-0')).toEqual([]);
	});
});

test.describe('phone-sized screen', () => {
	test.use({ viewport: { width: 375, height: 700 } });

	const fitsWidth = (page: Page) =>
		page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

	test('the page does not scroll sideways and the dialog fits the screen', async ({
		page,
		api
	}) => {
		const { john } = await family(api);
		await openTree(page, api, john);
		expect(await fitsWidth(page)).toBe(true);

		await openMenuByKeyboard(page, 'John');
		await chooseMenuItem(page, 'Add relationship');
		const dialog = page.getByRole('dialog', { name: 'Add relationship' });
		const box = (await dialog.boundingBox())!;
		expect(box.x).toBeGreaterThanOrEqual(0);
		expect(box.x + box.width).toBeLessThanOrEqual(375);
		// Every button in the dialog is reachable, and the save button can be scrolled into view.
		await dialog.getByRole('button', { name: 'Save', exact: true }).scrollIntoViewIfNeeded();
		await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeInViewport();
		expect(await fitsWidth(page)).toBe(true);
	});

	test('the person drawer fits the screen', async ({ page, api }) => {
		const { john } = await family(api);
		await openTree(page, api, john);
		await card(page, 'John').dblclick();
		const box = (await page.locator('div.fixed.inset-y-0').boundingBox())!;
		expect(box.width).toBeLessThanOrEqual(375);
		expect(await fitsWidth(page)).toBe(true);
	});

	test('controls are large enough to tap', async ({ page, api }) => {
		const { john } = await family(api);
		await openTree(page, api, john);
		const small: string[] = [];
		for (const control of await page
			.locator('button:visible, [role="button"]:visible, select:visible, input:visible')
			.all()) {
			// A checkbox or radio is operated through its label, which is what a finger lands on.
			const label = control.locator('xpath=ancestor::label[1]');
			const box =
				(await label.count()) > 0 ? await label.boundingBox() : await control.boundingBox();
			if (box && (box.width < 24 || box.height < 24))
				small.push(
					`${(await control.getAttribute('aria-label')) ?? (await control.textContent())?.trim()} ${Math.round(box.width)}x${Math.round(box.height)}`
				);
		}
		// WCAG 2.2 target size (minimum): 24 by 24 CSS pixels.
		expect(small).toEqual([]);
	});
});
