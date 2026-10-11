import { expect, open, test } from './support';

test('the depth and link-type controls change what the tree draws, and live in the address', async ({
	api,
	page
}) => {
	const parent = await api.addPerson('Perry', 'Controls', { birthDate: '1880', deathDate: '1950' });
	const bio = await api.addPerson('Bio', 'Controls', { birthDate: '1910', deathDate: '1990' });
	const adopted = await api.addPerson('Addie', 'Controls', {
		birthDate: '1912',
		deathDate: '1992'
	});
	const grand = await api.addPerson('Grandkid', 'Controls', {
		birthDate: '1940',
		deathDate: '2000'
	});
	await api.child(parent, bio);
	await api.relate({
		kind: 'add_child',
		parent: { id: parent.id, givenName: parent.givenName, surname: parent.surname },
		child: { id: adopted.id, givenName: adopted.givenName, surname: adopted.surname },
		type: 'adoptive',
		unionLabel: null
	});
	await api.child(bio, grand);

	const card = (name: string) => page.locator('[data-person-id]').filter({ hasText: name });
	await open(page, `/trees/${api.treeId}?focus=${encodeURIComponent(parent.id)}`);
	await expect(card('Bio')).toBeVisible();
	await expect(card('Addie')).toBeVisible();
	await expect(card('Grandkid')).toBeVisible();

	// Hiding adoptive links removes the adopted child, and the choice is in the address.
	await page.getByRole('button', { name: /^Display/ }).click();
	await page.getByRole('checkbox', { name: /Adoptive/ }).uncheck();
	await page.keyboard.press('Escape');
	await expect(card('Addie')).toHaveCount(0);
	await expect(card('Bio')).toBeVisible();
	await expect(page).toHaveURL(/types=/);
	await page.reload();
	await expect(card('Addie')).toHaveCount(0);
	await page.getByRole('button', { name: /^Display/ }).click();
	await page.getByRole('checkbox', { name: /Adoptive/ }).check();
	await page.keyboard.press('Escape');
	await expect(card('Addie')).toBeVisible();

	// One generation down leaves the grandchild behind a stub.
	await page.getByRole('button', { name: 'Fewer descendants generations' }).click();
	await page.getByRole('button', { name: 'Fewer descendants generations' }).click();
	await expect(page).toHaveURL(/down=1/);
	await expect(card('Grandkid')).toHaveCount(0);
	await expect(card('Bio')).toBeVisible();
});

test('the 3D picker chooses the WebGL view, and the 3D button returns to the last one', async ({
	api,
	page
}) => {
	const john = await api.addPerson('John', 'Picker');
	const kit = await api.addPerson('Kit', 'Picker');
	await api.child(john, kit);
	const layout = page.getByRole('group', { name: 'Layout' });

	await open(page, `/trees/${api.treeId}?focus=${encodeURIComponent(john.id)}`);
	await expect(layout.getByRole('button', { name: 'Flat' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await layout.getByRole('button', { name: 'Choose the 3D view' }).click();
	await page
		.getByRole('group', { name: '3D view' })
		.getByRole('button', { name: /^Ribbons/ })
		.click();
	await expect(page).toHaveURL(/mode=ribbons/);
	await expect(layout.getByRole('button', { name: '3D · Ribbons' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);

	// Back to Flat and then the 3D button: it returns to Ribbons, not to the first view in the list.
	await layout.getByRole('button', { name: 'Flat' }).click();
	await expect(page).toHaveURL(/mode=flat/);
	await layout.getByRole('button', { name: '3D · Ribbons' }).click();
	await expect(page).toHaveURL(/mode=ribbons/);
});
