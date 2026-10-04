import { expect, open, test } from './support';

test('the floors view switches in place, survives reload and Back, and opens the drawer from a floor', async ({
	api,
	page
}) => {
	const gran = await api.addPerson('Gran', 'Floors', { birthDate: '1900', deathDate: '1980' });
	const mum = await api.addPerson('Mum', 'Floors', { birthDate: '1930', deathDate: '2000' });
	const dad = await api.addPerson('Dad', 'Floors', { birthDate: '1928', deathDate: '1999' });
	const me = await api.addPerson('Me', 'Floors', { birthDate: '1960' });
	const sib = await api.addPerson('Sib', 'Floors', { birthDate: '1962' });
	const kid = await api.addPerson('Kid', 'Floors', { birthDate: '1990' });
	await api.child(gran, mum);
	await api.partner(mum, dad);
	await api.child(mum, me);
	await api.child(mum, sib);
	await api.child(me, kid);

	const card = (name: string) => page.locator('[data-person-id]').filter({ hasText: name });
	const mode = (name: string) =>
		page.getByRole('group', { name: 'Layout' }).getByRole('button', { name });

	await open(page, `/trees/${api.treeId}?focus=${encodeURIComponent(me.id)}&down=1`);
	await expect(card('Kid')).toBeVisible();
	await expect(page.getByRole('application', { name: 'Family tree' })).toBeVisible();
	await expect(mode('Flat')).toHaveAttribute('aria-pressed', 'true');
	await expect(mode('Layers')).toBeDisabled();

	// Switching keeps the focus and depth, and draws every person once on a floor.
	await mode('Floors').click();
	await expect(page).toHaveURL(/mode=floors/);
	await expect(page).toHaveURL(/down=1/);
	await expect(page.getByRole('application', { name: 'Family tree, floors view' })).toBeVisible();
	await expect(mode('Floors')).toHaveAttribute('aria-pressed', 'true');
	for (const name of ['Gran', 'Mum', 'Dad', 'Me', 'Sib', 'Kid'])
		await expect(card(name)).toHaveCount(1);
	await expect(page.getByRole('group', { name: 'Focus generation' })).toBeVisible();
	await expect(page.getByRole('group', { name: '1 generation up' })).toBeVisible();

	// The sibling is on a different row of the same floor from the focus.
	const rowOf = async (name: string) =>
		(await card(name).locator('.frame').first().boundingBox())!.y;
	expect(await rowOf('Sib')).not.toBeCloseTo(await rowOf('Me'), 0);

	// The cards sit where the transforms put them, so a click lands on the right person.
	await card('Kid').click();
	await expect(page).toHaveURL(new RegExp(`focus=${kid.id}`));
	await expect(page).toHaveURL(/mode=floors/);

	// A double-click opens the drawer from a floor, and the drawer survives switching back.
	await card('Mum').dblclick();
	await expect(page).toHaveURL(new RegExp(`person=${mum.id}`));
	await expect(page.getByRole('dialog').or(page.getByRole('complementary')).first()).toBeVisible();
	await mode('Flat').click();
	await expect(page).not.toHaveURL(/mode=/);
	await expect(page).toHaveURL(new RegExp(`person=${mum.id}`));
	await expect(page.getByRole('application', { name: 'Family tree', exact: true })).toBeVisible();

	// Back returns to the floors view, and a reload keeps it.
	await page.goBack();
	await expect(page).toHaveURL(/mode=floors/);
	await expect(page.getByRole('application', { name: 'Family tree, floors view' })).toBeVisible();
	await page.reload();
	await expect(page.getByRole('application', { name: 'Family tree, floors view' })).toBeVisible();
	await expect(card('Mum')).toHaveCount(1);
});
