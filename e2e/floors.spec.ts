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

test('side branches and the partner’s family are fetched for floors, and flat stops asking', async ({
	api,
	page
}) => {
	const gran = await api.addPerson('Gran', 'Wide', { birthDate: '1900', deathDate: '1980' });
	const mum = await api.addPerson('Mum', 'Wide', { birthDate: '1930', deathDate: '2000' });
	const aunt = await api.addPerson('Aunt', 'Wide', { birthDate: '1932', deathDate: '2001' });
	const cousin = await api.addPerson('Cousin', 'Wide', { birthDate: '1958' });
	const me = await api.addPerson('Me', 'Wide', { birthDate: '1960' });
	const wife = await api.addPerson('Wife', 'Wide', { birthDate: '1961' });
	const inLaw = await api.addPerson('InLaw', 'Wide', { birthDate: '1935', deathDate: '2010' });
	// Every parent has a partner, so each child belongs to a partnership; side branches and origins
	// follow partnerships, as the focus person's siblings always have.
	const grandpa = await api.addPerson('Grandpa', 'Wide', { birthDate: '1899', deathDate: '1970' });
	const dad = await api.addPerson('Dad', 'Wide', { birthDate: '1928', deathDate: '1999' });
	const uncle = await api.addPerson('Uncle', 'Wide', { birthDate: '1930', deathDate: '1995' });
	const inLawPartner = await api.addPerson('InLawPartner', 'Wide', { birthDate: '1936' });
	await api.partner(gran, grandpa);
	await api.partner(mum, dad);
	await api.partner(aunt, uncle);
	await api.partner(inLaw, inLawPartner);
	await api.child(gran, mum);
	await api.child(gran, aunt);
	await api.child(aunt, cousin);
	await api.child(mum, me);
	await api.partner(me, wife);
	await api.child(inLaw, wife);

	// "Gran" must not match "Grandpa", so the given name is matched whole.
	const card = (name: string) =>
		page.locator('[data-person-id]').filter({ hasText: new RegExp(`\\b${name} Wide`) });
	const mode = (name: string) =>
		page.getByRole('group', { name: 'Layout' }).getByRole('button', { name });
	const graphRequests: string[] = [];
	page.on('request', (r) => {
		if (r.url().includes('/graph?')) graphRequests.push(r.url());
	});

	await open(page, `/trees/${api.treeId}?focus=${encodeURIComponent(me.id)}&up=2`);
	await expect(card('Gran')).toHaveCount(1);
	// The flat toolbar has no wider-group controls, and flat draws neither group.
	await expect(page.getByRole('group', { name: 'Relatives off the direct line' })).toHaveCount(0);
	await expect(card('Aunt')).toHaveCount(0);

	await mode('Floors').click();
	await expect(page.getByRole('application', { name: 'Family tree, floors view' })).toBeVisible();
	await expect(card('Aunt')).toHaveCount(0);
	const more = page.getByRole('button', { name: 'More side branches' });
	await more.click();
	await expect(page).toHaveURL(/side=1/);
	await expect(card('Aunt')).toHaveCount(1);
	await expect(card('Cousin')).toHaveCount(0);
	expect(graphRequests.at(-1)).toContain('side=1');
	await more.click();
	await expect(page).toHaveURL(/side=2/);
	await expect(card('Cousin')).toHaveCount(1);

	await page.getByRole('checkbox', { name: 'Partner’s family' }).check();
	await expect(page).toHaveURL(/origins=1/);
	await expect(card('InLaw')).toHaveCount(1);
	// Both are part of the address, so a reload draws the same.
	await page.reload();
	await expect(card('InLaw')).toHaveCount(1);
	await expect(card('Cousin')).toHaveCount(1);

	// Back in flat the wider groups go, and the request stops asking for them.
	await mode('Flat').click();
	await expect(page).not.toHaveURL(/side=|origins=/);
	await expect(card('Aunt')).toHaveCount(0);
	expect(graphRequests.at(-1)).toContain('side=0&origins=0');
});
