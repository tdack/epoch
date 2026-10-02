import { readFileSync } from 'node:fs';
import { activate, chooseMenuItem, expect, openMenuByKeyboard, test } from './support';

const DIRTY_GED = readFileSync('docs/The_Simpsons.ged');
const TERRY = '@I_937df8d1@';

test('adding a child to Homer, who has several copies of one partnership, asks which and honours the choice', async ({
	page,
	request,
	api
}) => {
	// Imported without merging, so Homer and Marge's family exists several times over.
	const imported = await request.post('/api/import', {
		multipart: {
			file: { name: 'The_Simpsons.ged', mimeType: 'text/plain', buffer: DIRTY_GED },
			treeId: api.treeId,
			mode: 'replace'
		}
	});
	expect(imported.ok(), await imported.text()).toBe(true);
	const homerId = `${api.treeId}:${TERRY}`;
	await page.goto(`/trees/${api.treeId}?focus=${encodeURIComponent(homerId)}`);
	await expect(page.locator('[data-person-id]').filter({ hasText: 'Homer' }).first()).toBeVisible();

	await openMenuByKeyboard(page, 'Homer');
	await chooseMenuItem(page, 'Add relationship');
	const dialog = page.getByRole('dialog', { name: 'Add relationship' });
	await activate(dialog.getByRole('button', { name: 'Add child' }));
	await activate(dialog.getByRole('button', { name: 'New person' }));
	await dialog.getByLabel('Given name').fill('Newborn');

	// The chooser lists every partnership Homer is in, one already selected, with the reason.
	const chooser = dialog.getByTestId('union-chooser');
	await expect(chooser.getByRole('radio')).toHaveCount(4);
	await expect(chooser.getByRole('radio', { checked: true })).toHaveCount(1);
	await expect(dialog.getByTestId('union-reason')).toContainText('most children');
	await expect(chooser.getByText(/1st partnership · 0 children/)).toBeVisible();
	const defaultId = await chooser
		.getByRole('radio', { checked: true })
		.getAttribute('data-union-id');

	// Choose a different copy: the sentence names it by chronology and the reason goes away.
	const other = chooser.locator(`input[type="radio"]:not([data-union-id="${defaultId}"])`).first();
	const otherId = await other.getAttribute('data-union-id');
	await other.check();
	await expect(dialog.getByTestId('union-reason')).toHaveCount(0);
	await expect(
		dialog.getByText(
			/in the (1st|2nd|3rd) partnership of Homer Jay Simpson and Marjorie Jacqueline Bouvier|in the Homer Jay Simpson family/
		)
	).toBeVisible();
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();

	await expect(page.getByRole('status').filter({ hasText: 'Newborn' })).toBeVisible();
	const graph = await api.graph();
	const newborn = graph.people.find((p) => p.displayName === 'Newborn')!;
	const link = graph.parentChild.find((l) => l.childId === newborn.id && l.parentId === homerId);
	expect(link?.unionId).toBe(otherId);
	expect(link?.unionId).not.toBe(defaultId);

	await page.getByRole('button', { name: 'Undo' }).click();
	await expect
		.poll(async () => (await api.graph()).parentChild.some((l) => l.childId === newborn.id))
		.toBe(false);
});
