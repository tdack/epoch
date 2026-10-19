import { expect, open, test } from './support';

test('a person keeps two conflicting births, edits one, and undo restores it', async ({
	page,
	api
}) => {
	const wren = await api.addPerson('Wren', 'Ash', { birthDate: '4 MAR 1900', birthPlace: 'Leeds' });
	await open(page, `/trees/${api.treeId}/people/${encodeURIComponent(wren.id)}`);
	const facts = page.getByTestId('fact');
	await expect(facts).toHaveCount(1);

	// Add a second birth that disagrees. The dialog previews exactly what it will write.
	await page.getByRole('button', { name: 'Add fact' }).click();
	const dialog = page.getByRole('dialog', { name: 'Add a fact' });
	await dialog.getByLabel('Type', { exact: true }).selectOption('BIRT');
	await dialog.getByRole('textbox', { name: 'Date' }).fill('5 MAR 1900');
	await dialog.getByLabel('Place').fill('Hull');
	await expect(dialog.getByText('Added Birth of Wren Ash')).toBeVisible();
	await dialog.getByRole('button', { name: 'Add fact', exact: true }).click();
	await expect(dialog).toBeHidden();

	await expect(facts).toHaveCount(2);
	for (const fact of await facts.all()) {
		await expect(fact).toHaveAttribute('data-conflict', 'conflict');
		await expect(fact).toContainText('Disagrees with 1 other recorded birth');
	}
	await expect(page.getByText('dates disagree')).toBeVisible();

	// Edit only the second; the first stays exactly as it was.
	await facts.nth(1).getByRole('button', { name: 'Edit Birth' }).click();
	const edit = page.getByRole('dialog', { name: 'Edit fact' });
	await edit.getByLabel('Place').fill('York');
	await expect(edit.getByText('Changed Birth of Wren Ash')).toBeVisible();
	await edit.getByRole('button', { name: 'Save fact' }).click();
	await expect(edit).toBeHidden();
	await expect(facts.nth(0)).toContainText('Leeds');
	await expect(facts.nth(1)).toContainText('York');

	// Undo from the toast restores the second and leaves the first alone.
	await page.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(facts.nth(1)).toContainText('Hull');
	await expect(facts.nth(0)).toContainText('Leeds');
});

test('removing a fact lists what goes, and undo brings it back', async ({ page, api }) => {
	const wren = await api.addPerson('Wren', 'Ash');
	await open(page, `/trees/${api.treeId}/people/${encodeURIComponent(wren.id)}`);
	await page.getByRole('button', { name: 'Add fact' }).click();
	const dialog = page.getByRole('dialog', { name: 'Add a fact' });
	await dialog.getByLabel('Type', { exact: true }).selectOption('OCCU');
	await dialog.getByLabel('Value', { exact: true }).fill('Carpenter');
	await dialog.getByRole('button', { name: 'Add fact', exact: true }).click();
	await expect(page.locator('[data-section="glance"]')).toContainText('Occupation');
	await expect(page.getByTestId('fact')).toContainText('Carpenter');

	await page.getByRole('button', { name: 'Remove Occupation' }).click();
	const confirm = page.getByRole('dialog', { name: 'Remove this occupation?' });
	await expect(confirm.getByText('Occupation (Carpenter) of Wren Ash')).toBeVisible();
	await confirm.getByRole('button', { name: 'Remove fact' }).click();
	await expect(page.getByTestId('fact')).toHaveCount(0);

	await page.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(page.locator('[data-section="glance"]')).toContainText('Occupation');
	await expect(page.getByTestId('fact')).toContainText('Carpenter');
});

test('an invalid date blocks the save with a reason, and same-date facts can be reordered', async ({
	page,
	api
}) => {
	const wren = await api.addPerson('Wren', 'Ash');
	await open(page, `/trees/${api.treeId}/people/${encodeURIComponent(wren.id)}`);
	for (const [type, value] of [
		['RESI', 'Hull'],
		['RESI', 'York']
	] as const) {
		await page.getByRole('button', { name: 'Add fact' }).click();
		const dialog = page.getByRole('dialog', { name: 'Add a fact' });
		await dialog.getByLabel('Type', { exact: true }).selectOption(type);
		await dialog.getByLabel('Value', { exact: true }).fill(value);
		await dialog.getByRole('button', { name: 'Add fact', exact: true }).click();
		await expect(dialog).toBeHidden();
	}
	// Undated, so the later one is the newest shown and the earlier one is behind the button.
	const facts = page.getByTestId('fact');
	await expect(facts.nth(0)).toContainText('York');
	await page.getByRole('button', { name: 'Show 1 earlier' }).click();

	await facts.nth(1).getByRole('button', { name: 'Move Residence up' }).click();
	await expect(facts.nth(0)).toContainText('Hull');

	await page.getByRole('button', { name: 'Add fact' }).click();
	const dialog = page.getByRole('dialog', { name: 'Add a fact' });
	await dialog.getByRole('textbox', { name: 'Date' }).fill('not a date at all');
	await dialog.getByRole('textbox', { name: 'Date' }).blur();
	await expect(dialog.getByRole('button', { name: 'Add fact', exact: true })).toBeDisabled();
});

test('the date picker opens fully inside the fact dialog, even for a field near its bottom edge', async ({
	page,
	api
}) => {
	const wren = await api.addPerson('Wren', 'Ash');
	await page.setViewportSize({ width: 1280, height: 600 });
	await open(page, `/trees/${api.treeId}/people/${encodeURIComponent(wren.id)}`);
	await page.getByRole('button', { name: 'Add fact' }).click();
	const dialog = page.getByRole('dialog', { name: 'Add a fact' });
	await dialog.getByRole('button', { name: 'Pick a date' }).click();
	const picker = page.getByRole('dialog', { name: 'Date picker' });
	await expect(picker).toBeVisible();
	const box = (await picker.boundingBox())!;
	const viewport = page.viewportSize()!;
	expect(box.x).toBeGreaterThanOrEqual(0);
	expect(box.y).toBeGreaterThanOrEqual(0);
	expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
	expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
	await picker.getByRole('button', { name: /^15 / }).click();
	await expect(dialog.getByRole('textbox', { name: 'Date' })).toHaveValue(/^15 [A-Z]{3} \d{4}$/);
});

test('the date picker stays open when the window resizes, as a phone keyboard does', async ({
	page,
	api
}) => {
	const wren = await api.addPerson('Wren', 'Ash');
	await page.setViewportSize({ width: 375, height: 700 });
	await open(page, `/trees/${api.treeId}/people/${encodeURIComponent(wren.id)}`);
	await page.getByRole('button', { name: 'Add fact' }).click();
	const dialog = page.getByRole('dialog', { name: 'Add a fact' });
	await dialog.getByRole('button', { name: 'Pick a date' }).click();
	const picker = page.getByRole('dialog', { name: 'Date picker' });
	await picker.getByRole('spinbutton', { name: 'Year' }).focus();
	await page.setViewportSize({ width: 375, height: 420 });
	await expect(picker).toBeVisible();
	const box = (await picker.boundingBox())!;
	expect(box.x).toBeGreaterThanOrEqual(0);
	expect(box.x + box.width).toBeLessThanOrEqual(375);
});

test('a fact keeps its address and agency, and an edit to the address is undone', async ({
	page,
	api
}) => {
	const wren = await api.addPerson('Wren', 'Ash');
	await open(page, `/trees/${api.treeId}/people/${encodeURIComponent(wren.id)}`);
	await page.getByRole('button', { name: 'Add fact' }).click();
	const dialog = page.getByRole('dialog', { name: 'Add a fact' });
	await dialog.getByLabel('Type', { exact: true }).selectOption('BIRT');
	await dialog.getByLabel('Place').fill('Hull');
	await dialog.locator('summary', { hasText: 'Details' }).click();
	await dialog.getByLabel('Address').fill('12 High St\nHull');
	await dialog.getByLabel('Agency').fill('Parish of St Mary');
	await dialog.getByRole('button', { name: 'Add fact', exact: true }).click();
	await expect(dialog).toBeHidden();

	const fact = page.getByTestId('fact');
	await expect(fact.getByTestId('fact-address')).toContainText('12 High St');
	await expect(fact.getByTestId('fact-agency')).toContainText('Parish of St Mary');

	// A fact with details opens its Details section by itself, so the address is editable at once.
	await fact.getByRole('button', { name: 'Edit Birth' }).click();
	const edit = page.getByRole('dialog', { name: 'Edit fact' });
	await expect(edit.getByLabel('Address')).toHaveValue('12 High St\nHull');
	await edit.getByLabel('Address').fill('14 High St\nHull');
	await edit.getByRole('button', { name: 'Save fact' }).click();
	await expect(edit).toBeHidden();
	await expect(fact.getByTestId('fact-address')).toContainText('14 High St');

	await page.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(fact.getByTestId('fact-address')).toContainText('12 High St');
	await expect(fact.getByTestId('fact-address')).not.toContainText('14 High St');
});
