import { expect, open, test } from './support';

test('the layers view puts each family on its own plane, keeps each side on its side, and centres on a chosen union', async ({
	api,
	page
}) => {
	const me = await api.addPerson('Me', 'Layers', { birthDate: '1960' });
	const wife = await api.addPerson('Wife', 'Layers', { birthDate: '1961' });
	const ex = await api.addPerson('Ex', 'Layers', { birthDate: '1958' });
	const mum = await api.addPerson('Mum', 'Layers', { birthDate: '1930', deathDate: '2000' });
	const dad = await api.addPerson('Dad', 'Layers', { birthDate: '1928', deathDate: '1999' });
	const inLaw = await api.addPerson('InLaw', 'Layers', { birthDate: '1935', deathDate: '2010' });
	const inLawPartner = await api.addPerson('InLawPartner', 'Layers', {
		birthDate: '1936',
		deathDate: '2011'
	});
	const sib = await api.addPerson('Sib', 'Layers', { birthDate: '1962' });
	const kid = await api.addPerson('Kid', 'Layers', { birthDate: '1990' });
	const exKid = await api.addPerson('ExKid', 'Layers', { birthDate: '1985' });
	await api.partner(me, wife);
	await api.partner(me, ex);
	await api.partner(mum, dad);
	await api.partner(inLaw, inLawPartner);
	await api.child(mum, me);
	await api.child(mum, sib);
	await api.child(inLaw, wife);
	await api.child(me, kid);
	await api.child(ex, exKid);

	const card = (name: string) =>
		page.locator('[data-person-id]').filter({ hasText: new RegExp(`\\b${name} Layers`) });
	const mode = (name: string) =>
		page.getByRole('group', { name: 'Layout' }).getByRole('button', { name });
	const canvas = page.getByRole('application', { name: 'Family tree, layers view' });
	const left = async (name: string) =>
		(await card(name).locator('.frame').first().boundingBox())!.x;

	await open(page, `/trees/${api.treeId}?focus=${encodeURIComponent(me.id)}&up=2&down=1`);
	await expect(card('Me')).toBeVisible();
	await expect(mode('Layers')).toBeEnabled();

	// Arriving asks for the wider groups, and keeps the focus and depth. Layers' own defaults stay
	// out of the address, so a direct ?mode=layers link and this click are the same view.
	await mode('Layers').click();
	await expect(page).toHaveURL(/mode=layers/);
	await expect(page).not.toHaveURL(/side=|origins=/);
	await expect(page).toHaveURL(/up=2/);
	await expect(canvas).toBeVisible();
	await expect(mode('Layers')).toHaveAttribute('aria-pressed', 'true');
	for (const name of ['Me', 'Wife', 'Mum', 'Dad', 'InLaw', 'InLawPartner', 'Sib', 'Kid', 'Ex'])
		await expect(card(name)).toHaveCount(1);

	// One labelled group per plane, and a placeholder where a plane needs someone from another.
	await expect(page.getByRole('group', { name: 'The union and its descendants' })).toBeVisible();
	await expect(page.getByRole('group', { name: 'The families it came from' })).toBeVisible();
	await expect(page.locator('[data-ghost-id]').first()).toBeAttached();

	// The first partner's family is left of the second's, by union order and not by sex.
	const first = (await left('Me')) < (await left('Wife')) ? 'Mum' : 'InLaw';
	const second = first === 'Mum' ? 'InLaw' : 'Mum';
	expect(await left(first)).toBeLessThan(await left(second));

	// The camera and the planes are the viewer's to change, and neither touches the address.
	const url = page.url();
	await canvas.getByRole('button', { name: 'Exploded' }).click();
	await expect(canvas.getByRole('button', { name: 'Exploded' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await canvas.getByRole('checkbox', { name: 'Show the families it came from' }).uncheck();
	await expect(card('Mum')).toHaveCount(0);
	await expect(card('Me')).toHaveCount(1);
	await canvas.getByRole('checkbox', { name: 'Show the families it came from' }).check();
	await expect(card('Mum')).toHaveCount(1);
	expect(page.url()).toBe(url);

	// A second partnership offers a picker; choosing it recentres, survives reload, and a new focus resets it.
	const chip = page.getByRole('toolbar').locator('button[aria-haspopup="menu"]').first();
	await chip.click();
	const choices = page.getByRole('menuitemradio');
	await expect(choices).toHaveCount(2);
	await choices.filter({ hasText: /^Ex/ }).click();
	await expect(page).toHaveURL(/union=/);
	await expect(card('ExKid')).toHaveCount(1);
	await expect(chip).toContainText('with Ex');
	await page.reload();
	await expect(chip).toContainText('with Ex');
	await expect(card('ExKid')).toHaveCount(1);
	await card('Kid').click();
	await expect(page).toHaveURL(new RegExp(`focus=${kid.id}`));
	await expect(page).not.toHaveURL(/union=/);

	// A double-click opens the drawer from a plane, and Flat takes it back to the hourglass.
	await card('Mum').dblclick();
	await expect(page).toHaveURL(new RegExp(`person=${mum.id}`));
	await mode('Flat').click();
	await expect(page).toHaveURL(/mode=flat/);
	await expect(page).not.toHaveURL(/side=|origins=|union=/);
	await expect(page).toHaveURL(new RegExp(`person=${mum.id}`));
	await expect(page.getByRole('application', { name: 'Family tree', exact: true })).toBeVisible();
	await page.goBack();
	await expect(page).toHaveURL(/mode=layers/);
	await expect(canvas).toBeVisible();
});

test('layers moves a generation back into either partner’s family and forward again', async ({
	api,
	page
}) => {
	const me = await api.addPerson('Me', 'Dive', { birthDate: '1960' });
	const wife = await api.addPerson('Wife', 'Dive', { birthDate: '1961' });
	const mum = await api.addPerson('Mum', 'Dive', { birthDate: '1930' });
	const dad = await api.addPerson('Dad', 'Dive', { birthDate: '1928' });
	const inLaw = await api.addPerson('InLaw', 'Dive', { birthDate: '1935' });
	const inLawPartner = await api.addPerson('InLawPartner', 'Dive', { birthDate: '1936' });
	await api.partner(me, wife);
	await api.partner(mum, dad);
	await api.partner(inLaw, inLawPartner);
	await api.child(mum, me);
	await api.child(inLaw, wife);

	const canvas = page.getByRole('application', { name: 'Family tree, layers view' });
	const rail = canvas.getByRole('list', { name: 'Generations, earliest first' });
	const card = (name: string) =>
		page.locator('[data-person-id]').filter({ hasText: new RegExp(`\\b${name} Dive`) });
	const expectFocus = (id: string) =>
		expect.poll(() => new URL(page.url()).searchParams.get('focus')).toBe(id);

	await open(page, `/trees/${api.treeId}?focus=${encodeURIComponent(me.id)}&up=2&mode=layers`);
	await expect(card('Me')).toHaveCount(1);
	await expect(rail.locator('[aria-current="step"]')).toContainText('Me Dive & Wife Dive');

	// Page Up dives into the cursor's side, and lands on the parents' partnership, not just a parent.
	await card('Me').focus();
	await page.keyboard.press('PageUp');
	await expectFocus(mum.id);
	await expect(page).toHaveURL(/union=/);
	await expect(rail.locator('[aria-current="step"]')).toContainText('Mum Dive & Dad Dive');
	await expect(canvas.locator('[aria-live="polite"]')).toContainText('Back one generation.');

	// Page Down surfaces to where the dive started.
	await card('Mum').focus();
	await page.keyboard.press('PageDown');
	await expectFocus(me.id);
	await expect(rail.locator('[aria-current="step"]')).toContainText('Me Dive & Wife Dive');

	// The rail reaches the other partner's family, and Back retraces the move.
	await rail.getByRole('button', { name: /InLaw Dive & InLawPartner Dive/ }).click();
	await expectFocus(inLaw.id);
	await expect(rail.getByRole('button', { name: /One generation forward/ })).toContainText(
		'Me Dive & Wife Dive'
	);
	await page.goBack();
	await expectFocus(me.id);
	await expect(rail.getByRole('button', { name: /generation forward/ })).toHaveCount(0);
});
