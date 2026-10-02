import { expect, open, test } from './support';

const SHOTS = process.env.E2E_SHOTS ?? 'test-results';

test('two records of one person are compared, merged in one change, and the merge is undone', async ({ api, page }) => {
	const mum = await api.addPerson('Mabel', 'Merge', { birthDate: '1870' });
	const ann = await api.addPerson('Ann', 'Merge', { sex: 'F', birthDate: '1900', birthPlace: 'Leeds' });
	const twin = await api.addPerson('Annie', 'Merge', { sex: 'F', birthDate: '1901', birthPlace: 'Hull' });
	const kid = await api.addPerson('Kit', 'Merge', { birthDate: '1925' });
	await api.child(mum, ann);
	await api.child(mum, twin);
	await api.child(twin, kid);
	const stranger = await api.addPerson('Zed', 'Other', { sex: 'M' });

	await open(page, `/trees/${api.treeId}/people/${encodeURIComponent(ann.id)}`);
	await page.getByTestId('merge-person').click();
	const dialog = page.getByRole('dialog', { name: 'Merge with another record of this person' });
	await dialog.getByLabel('The other record of this person').fill('Annie');
	await dialog.getByRole('option', { name: /Annie Merge/ }).click();

	// Side by side, with the differing births both visible.
	await expect(dialog.getByTestId('merge-side')).toHaveCount(2);
	await expect(dialog.getByTestId('merge-side').first()).toContainText('1900, Leeds');
	await expect(dialog.getByTestId('merge-side').last()).toContainText('1901, Hull');
	await expect(dialog.getByTestId('merge-notes')).toContainText('2 births recorded');
	await expect(dialog.getByText('This is exactly what will change:')).toBeVisible();
	await page.screenshot({ path: `${SHOTS}/person-merge.png` });

	// A pair that cannot be one person is refused instead of previewed.
	await dialog.getByLabel('The other record of this person').fill('Mabel');
	await dialog.getByRole('option', { name: /Mabel Merge/ }).click();
	await expect(dialog.getByTestId('merge-refusal')).toContainText('ancestor');
	await expect(dialog.getByRole('button', { name: 'Merge people' })).toBeDisabled();

	// A different sex must be chosen before there is anything to confirm.
	await dialog.getByLabel('The other record of this person').fill('Zed');
	await dialog.getByRole('option', { name: /Zed Other/ }).click();
	await expect(dialog.getByTestId('merge-conflict')).toBeVisible();
	await expect(dialog.getByRole('button', { name: 'Merge people' })).toBeDisabled();

	await dialog.getByLabel('The other record of this person').fill('Annie');
	await dialog.getByRole('option', { name: /Annie Merge/ }).click();
	// Keep the other record: the page moves to it, and it has the child and the first record's facts.
	await dialog.getByRole('radio', { name: /Annie Merge/ }).check();
	await expect(dialog.getByTestId('merge-side').first()).toContainText('Annie Merge');
	await dialog.getByRole('button', { name: 'Merge people' }).click();

	await expect(page.getByRole('region', { name: 'Notifications' }).getByText(/^Merged Ann Merge into Annie Merge/)).toBeVisible();
	await expect(page.getByTestId('person-name')).toHaveText('Annie Merge');
	await expect.poll(async () => (await api.graph()).people.some((p) => p.id === ann.id)).toBe(false);
	await expect(page.getByTestId('facts').getByText(/1900/).first()).toBeVisible();

	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(page.getByTestId('person-name')).toHaveText('Ann Merge');
	await expect.poll(async () => (await api.graph()).people.some((p) => p.id === ann.id)).toBe(true);
	void kid; void stranger;
});
