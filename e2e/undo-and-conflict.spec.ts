import { card, expect, openTree, test } from './support';

test('undo from the toast reverts the change', async ({ page, api }) => {
	const [a, b] = [await api.addPerson('Ann'), await api.addPerson('Ben')];
	await openTree(page, api, a);

	await card(page, 'Ann').click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Add relationship' }).click();
	const dialog = page.getByRole('dialog', { name: 'Add relationship' });
	await dialog.getByRole('button', { name: 'Add partner' }).click();
	await dialog.getByLabel('Search people by name').fill('Ben');
	await dialog.getByLabel('Search people by name').press('Enter');
	await dialog.getByRole('button', { name: 'Ben' }).click();
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();

	const toast = page.getByRole('status').filter({ hasText: 'Ben was recorded as Ann' });
	await expect(toast).toBeVisible();
	expect((await api.graph()).unions).toHaveLength(1);

	await toast.getByRole('button', { name: 'Undo' }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Undid:' })).toBeVisible();
	expect((await api.graph()).unions).toHaveLength(0);
	expect(b.id).toBeTruthy();
});

test('a refused undo tells the person why', async ({ page, api }) => {
	// The refusal itself (a different user's later change to the same records) is covered by the
	// service tests; there is no way to add a second collaborator here, so the server's answer is
	// stubbed to check the message reaches the person.
	const ann = await api.addPerson('Ann');
	await openTree(page, api, ann);
	await page.route('**/api/trees/*/undo', (route) =>
		route.request().method() === 'POST'
			? route.fulfill({
					status: 409,
					contentType: 'application/json',
					body: JSON.stringify({
						error:
							'Can\'t undo "Edited Ann" because a later change ("Edited Ann") also changed those records.',
						code: 'UNDO_REFUSED',
						details: { reason: 'touched_later' }
					})
				})
			: route.continue()
	);

	await card(page, 'Ann').click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Edit person' }).click();
	const form = page.getByRole('dialog', { name: 'Edit Person Details' });
	await form.getByLabel('Surname').fill('Archer');
	await form.getByRole('button', { name: /Save/ }).click();
	await page
		.getByRole('status')
		.filter({ hasText: 'Edited Ann' })
		.getByRole('button', { name: 'Undo' })
		.click();
	await expect(page.getByRole('alert').filter({ hasText: "Can't undo" })).toBeVisible();
});

test('a concurrent edit opens the conflict dialog and never overwrites silently', async ({
	page,
	request,
	api
}) => {
	const ann = await api.addPerson('Ann', 'Archer');
	await openTree(page, api, ann);
	await card(page, 'Ann').click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Edit person' }).click();
	const form = page.getByRole('dialog', { name: 'Edit Person Details' });
	// The form opens only once it has fetched the person, and its version is the one that one fetch
	// saw. Changing the person before it is visible lets the fetch see the change, and there is then
	// nothing to conflict with (this was the test's intermittent failure).
	await expect(form).toBeVisible();

	// While the form is open, someone else saves a different change to the same person.
	const res = await request.put(`/api/trees/${api.treeId}/individuals/${ann.id}`, {
		data: { givenName: 'Anna', version: ann.version }
	});
	expect(res.ok()).toBe(true);

	await form.getByLabel('Surname').fill('Archer-Bell');
	await form.getByRole('button', { name: /Save/ }).click();

	const conflict = page.getByRole('dialog', { name: 'Someone else changed this' });
	await expect(conflict).toBeVisible();
	// Only the field I changed is offered for re-applying; my untouched given name is not in play.
	await expect(conflict.getByRole('row', { name: /Surname/ })).toContainText('Archer-Bell');
	await expect(conflict.getByRole('row', { name: /Given names/ })).toHaveCount(0);
	const stored = await request.get(`/api/trees/${api.treeId}/individuals/${ann.id}`);
	expect((await stored.json()).individual).toMatchObject({ givenName: 'Anna', surname: 'Archer' });

	await conflict.getByRole('button', { name: 'Re-apply my changes' }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Edited' })).toBeVisible();
	const after = await request.get(`/api/trees/${api.treeId}/individuals/${ann.id}`);
	expect((await after.json()).individual).toMatchObject({
		givenName: 'Anna',
		surname: 'Archer-Bell'
	});
});
