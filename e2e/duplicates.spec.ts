import { readFileSync } from 'node:fs';
import { type APIRequestContext, type Page } from '@playwright/test';
import { chooseMenuItem, expect, test, type Api } from './support';

const DIRTY_GED = readFileSync('docs/The_Simpsons.ged');
const XREF = { bart: '@I_c2773035@', jessica: '@I_cc833eb7@' } as const;

/** The dirty file, imported as written into the test's own tree: duplicates and all. */
async function importDirty(request: APIRequestContext, api: Api) {
	const res = await request.post('/api/import', {
		multipart: { file: { name: 'The_Simpsons.ged', mimeType: 'text/plain', buffer: DIRTY_GED }, treeId: api.treeId, mode: 'replace' }
	});
	expect(res.ok(), await res.text()).toBe(true);
}

async function openBart(page: Page, api: Api) {
	await page.goto(`/trees/${api.treeId}?focus=${encodeURIComponent(`${api.treeId}:${XREF.bart}`)}`);
	await expect(page.locator('[data-person-id]').filter({ hasText: 'Bart' }).first()).toBeVisible();
}

const bartJessicaMarker = (page: Page, position: '1st' | '2nd') =>
	page.locator(`[data-union-id][aria-label^="${position} partnership of Bart"]`);

test('repeated partnerships between one pair are labelled 1st and 2nd, in the canvas and the drawer', async ({ page, request, api }) => {
	await importDirty(request, api);
	await openBart(page, api);

	await expect(bartJessicaMarker(page, '1st')).toBeAttached();
	await expect(bartJessicaMarker(page, '2nd')).toBeAttached();
	await expect(page.locator('text.label', { hasText: '1st · 3 Nov 2014' })).toBeVisible();
	await expect(page.locator('text.label', { hasText: '2nd · 3 Nov 2014' })).toBeVisible();

	// The drawer shows what is stored: both partnerships, not a collapsed one.
	await page.locator('[data-person-id]').filter({ hasText: 'Bart' }).first().dblclick();
	const drawer = page.locator('div.fixed.inset-y-0');
	await expect(drawer.getByText('1st partnership (m. 3 Nov 2014)')).toBeVisible();
	await expect(drawer.getByText('2nd partnership (m. 3 Nov 2014)')).toBeVisible();
	await expect(drawer.getByRole('button', { name: 'Merge…' })).toHaveCount(2);
	// Oldest first.
	const titles = await drawer.getByText(/partnership \(m\./).allTextContents();
	expect(titles.map((t) => t.trim().slice(0, 3))).toEqual(['1st', '2nd']);
});

test('merging duplicate partnerships from the union menu previews the change, then undoes cleanly', async ({ page, request, api }) => {
	await importDirty(request, api);
	await openBart(page, api);
	expect((await api.graph()).unions).toHaveLength(10);

	await bartJessicaMarker(page, '2nd').focus();
	await page.keyboard.press('Shift+F10');
	await expect(page.getByRole('menu')).toBeVisible();
	await chooseMenuItem(page, 'Merge duplicate partnerships…');

	const dialog = page.getByRole('dialog', { name: 'Merge duplicate partnerships?' });
	await expect(dialog.getByRole('checkbox')).toHaveCount(2);
	await expect(dialog.getByText('This is exactly what will change:')).toBeVisible();
	// Both share a name, so the preview tells them apart by chronology.
	await expect(dialog.getByText(/partnership \(2nd of 2, m\. 3 Nov 2014\)/).first()).toBeVisible();
	await expect(dialog.getByText('Deleted').first()).toBeVisible();
	await dialog.getByRole('button', { name: 'Merge partnerships' }).click();

	await expect(page.getByText(/Merged 2 partnerships/)).toBeVisible();
	await expect.poll(async () => (await api.graph()).unions.length).toBe(9);
	await expect(page.locator('[data-union-id][aria-label*="Bart"][aria-label*="Jessica"]')).toHaveCount(1);

	await page.getByRole('button', { name: 'Undo' }).click();
	await expect.poll(async () => (await api.graph()).unions.length).toBe(10);
});

test('two different marriage dates are never merged silently: a choice is required', async ({ page, request, api }) => {
	await importDirty(request, api);
	const graph = await api.graph();
	const [first, second] = graph.unions.filter(
		(u) => u.partnerIds.includes(`${api.treeId}:${XREF.bart}`) && u.partnerIds.includes(`${api.treeId}:${XREF.jessica}`)
	);
	const marriageOf = (u: typeof first) => u.events!.find((e) => e.type === 'MARR') as { id: string };
	const res = await request.put(`/api/trees/${api.treeId}/unions/${second.id}`, {
		data: { version: second.version, events: [{ id: marriageOf(second).id, type: 'MARR', dateText: '1 Jan 2012', place: null }] }
	});
	expect(res.ok(), await res.text()).toBe(true);
	void first;

	await openBart(page, api);
	await page.locator('[data-union-id][aria-label*="Bart"][aria-label*="Jessica"]').first().focus();
	await page.keyboard.press('Shift+F10');
	await chooseMenuItem(page, 'Merge duplicate partnerships…');

	const dialog = page.getByRole('dialog', { name: 'Merge duplicate partnerships?' });
	await expect(dialog.getByText(/record a different marriage/)).toBeVisible();
	await expect(dialog.getByRole('button', { name: 'Merge partnerships' })).toBeDisabled();
	await dialog.getByRole('radio', { name: /1 Jan 2012/ }).check();
	await expect(dialog.getByText('This is exactly what will change:')).toBeVisible();
	await dialog.getByRole('button', { name: 'Merge partnerships' }).click();

	await expect.poll(async () => (await api.graph()).unions.length).toBe(9);
	const kept = (await api.graph()).unions.filter((u) => u.partnerIds.length === 2 && u.events?.some((e) => e.type === 'MARR'));
	expect(kept.map((u) => u.events![0].dateText)).toEqual(['1 Jan 2012']);
});

test('the import preview lists duplicate families, merges exact ones by default, and lists possible ones for review', async ({ page, api }) => {
	// Into the test's own tree, so "replace" cannot touch anyone's real data.
	await page.goto(`/trees/${api.treeId}`);
	// The tree banner only appears once the page has hydrated and loaded the tree; a file chosen sooner is ignored.
	await expect(page.getByText('Active Tree')).toBeVisible();
	await page.setInputFiles('input[type="file"]', 'docs/The_Simpsons.ged');

	const dialog = page.getByRole('dialog', { name: 'Import GEDCOM' });
	await expect(dialog.getByText('Duplicate families', { exact: true })).toBeVisible();
	await expect(dialog.getByText(/Homer Jay Simpson and Marjorie Jacqueline Bouvier: 3 copies/)).toBeVisible();
	await expect(dialog.getByText(/Possible duplicates/)).toBeVisible();
	await expect(dialog.getByText(/the same single partner, listed more than once/)).toBeVisible();
	// The counts follow the checkbox: ten families in the file, seven once the duplicates are merged.
	await expect(dialog.getByText(/10 families \(7 once duplicates are merged\)/)).toBeVisible();
	await expect(dialog.getByText(/so it cannot be merged/).first()).toBeVisible();
	await dialog.getByRole('checkbox', { name: /Merge duplicate families/ }).uncheck();
	await expect(dialog.getByText(/once duplicates are merged/)).toHaveCount(0);
	await dialog.getByRole('checkbox', { name: /Merge duplicate families/ }).check();
	await expect(dialog.getByRole('checkbox', { name: /Merge duplicate families/ })).toBeChecked();

	await dialog.getByRole('button', { name: /replace/i }).click();
	await expect(page.getByText(/3 duplicate families merged/)).toBeVisible();
	expect((await api.graph()).unions).toHaveLength(7);
});

test('unticking the merge option imports the file exactly as written', async ({ page, api }) => {
	await page.goto(`/trees/${api.treeId}`);
	// The tree banner only appears once the page has hydrated and loaded the tree; a file chosen sooner is ignored.
	await expect(page.getByText('Active Tree')).toBeVisible();
	await page.setInputFiles('input[type="file"]', 'docs/The_Simpsons.ged');

	const dialog = page.getByRole('dialog', { name: 'Import GEDCOM' });
	await dialog.getByRole('checkbox', { name: /Merge duplicate families/ }).uncheck();
	await dialog.getByRole('button', { name: /replace/i }).click();
	await expect(page.getByText(/Import complete: 13 individuals, 10 families\./)).toBeVisible();
	expect((await api.graph()).unions).toHaveLength(10);
});

test('a partnership with one recorded parent says so in the drawer, and its editor shows who is in it', async ({ page, request, api }) => {
	await importDirty(request, api);
	await page.goto(`/trees/${api.treeId}?focus=${encodeURIComponent(`${api.treeId}:@I_937df8d1@`)}`);
	const person = page.locator('[data-person-id]').filter({ hasText: 'Homer' }).first();
	await expect(person).toBeVisible();
	await person.dblclick();
	const drawer = page.locator('div.fixed.inset-y-0');
	await expect(drawer.getByText('Children, other parent not recorded').first()).toBeVisible();

	const editButtons = drawer.getByRole('button', { name: 'Dates & status', exact: true });
	const count = await editButtons.count();
	let sawSingle = false;
	for (let i = 0; i < count && !sawSingle; i++) {
		await editButtons.nth(i).click();
		const members = page.getByTestId('union-members');
		await expect(members).toBeVisible();
		sawSingle = await members.getByText('Only one parent is recorded').isVisible();
		await page.getByRole('button', { name: 'Cancel' }).click();
	}
	expect(sawSingle).toBe(true);
});
