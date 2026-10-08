/**
 * The Orrery view: a WebGL star cluster with the focus line named in the DOM over it. The stars
 * are not in the accessibility tree, so these tests drive the names and the camera controls, and
 * click a star through its name's position.
 */
import { expect, open, test } from './support';

test('orrery opens from the address and names the focus person', async ({ api, page }) => {
	const mum = await api.addPerson('Mum', 'Orrery', { birthDate: '1930' });
	const me = await api.addPerson('Me', 'Orrery', { birthDate: '1960' });
	await api.child(mum, me);

	await open(page, `/trees/${api.treeId}?focus=${encodeURIComponent(me.id)}&mode=orrery`);
	const view = page.getByRole('group', { name: 'Orrery view' });
	await expect(view).toBeVisible();
	await expect(view.getByRole('button', { name: /^Me Orrery\b/ })).toBeVisible();
	await expect(
		page.getByRole('group', { name: 'Layout' }).getByRole('button', { name: '3D · Orrery' })
	).toHaveAttribute('aria-pressed', 'true');
});

test('orrery names the focus line, refocuses from a name and picks a star', async ({
	api,
	page
}) => {
	const gran = await api.addPerson('Gran', 'Orrery', { birthDate: '1900', deathDate: '1980' });
	const mum = await api.addPerson('Mum', 'Orrery', { birthDate: '1930', deathDate: '2000' });
	const dad = await api.addPerson('Dad', 'Orrery', { birthDate: '1928', deathDate: '1999' });
	const me = await api.addPerson('Me', 'Orrery', { birthDate: '1960' });
	const sib = await api.addPerson('Sib', 'Orrery', { birthDate: '1962' });
	const kid = await api.addPerson('Kid', 'Orrery', { birthDate: '1990' });
	await api.child(gran, mum);
	await api.partner(mum, dad);
	await api.child(mum, me);
	await api.child(mum, sib);
	await api.child(me, kid);

	// The stars drift; stopping that makes the click below land where the name says.
	await page.emulateMedia({ reducedMotion: 'reduce' });
	const orrery = page.getByRole('group', { name: 'Orrery view' });
	const name = (given: string) =>
		orrery.getByRole('button', { name: new RegExp(`^${given} Orrery\\b`) });

	await open(page, `/trees/${api.treeId}?focus=${encodeURIComponent(me.id)}&mode=orrery`);
	await expect(orrery).toBeVisible();

	// The focus line is named; a sibling, and a parent's partner who is not a parent, are not.
	for (const given of ['Gran', 'Mum', 'Me', 'Kid']) await expect(name(given)).toBeVisible();
	await expect(name('Sib')).toHaveCount(0);
	await expect(name('Dad')).toHaveCount(0);
	await orrery.getByRole('button', { name: 'All names' }).click();
	await expect(name('Sib')).toBeVisible();

	// A name refocuses the orrery on that person; Shift+Enter opens their details.
	await name('Kid').click();
	await expect(page).toHaveURL(new RegExp(`focus=${kid.id}`));
	await expect(page).toHaveURL(/mode=orrery/);
	await name('Mum').focus();
	await page.keyboard.press('Shift+Enter');
	await expect(page).toHaveURL(new RegExp(`person=${mum.id}`));

	// The camera presets change the view without touching the address.
	const before = page.url();
	await orrery.getByRole('button', { name: 'Side' }).click();
	await expect(orrery.getByRole('button', { name: 'Side' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	expect(page.url()).toBe(before);

	// Clicking the star under a name picks that person, through the WebGL scene. Names follow the
	// scene a frame behind the camera, so read the name after two frames; a miss lands on someone
	// else, so the whole step is retried from a fresh reading.
	await page.keyboard.press('Escape');
	await expect(page).not.toHaveURL(/person=/);
	await expect(async () => {
		await page.evaluate(
			() =>
				new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null))))
		);
		const box = (await name('Gran').boundingBox())!;
		// The name sits 10px above its star's centre.
		await page.mouse.click(box.x + box.width / 2, box.y + box.height + 10);
		await expect(page).toHaveURL(new RegExp(`focus=${gran.id}`), { timeout: 2000 });
	}).toPass({ timeout: 15000 });

	// Back to flat keeps the focus.
	await page.getByRole('group', { name: 'Layout' }).getByRole('button', { name: 'Flat' }).click();
	await expect(page).toHaveURL(/mode=flat/);
	await expect(page).toHaveURL(new RegExp(`focus=${gran.id}`));
});

test('orrery draws the stars moving, and holds still when motion is reduced', async ({
	api,
	page
}) => {
	const mum = await api.addPerson('Mum', 'Orrery');
	const dad = await api.addPerson('Dad', 'Orrery');
	const me = await api.addPerson('Me', 'Orrery');
	await api.partner(mum, dad);
	await api.child(mum, me);

	// The signal is the name, which moves with its star; a WebGL canvas without a preserved
	// drawing buffer reads back blank, so the pixels say nothing.
	const nameBox = async () =>
		JSON.stringify(
			await page
				.getByRole('group', { name: 'Orrery view' })
				.getByRole('button', { name: /^Me Orrery\b/ })
				.boundingBox()
		);

	await open(page, `/trees/${api.treeId}?focus=${encodeURIComponent(me.id)}&mode=orrery`);
	await expect(page.getByRole('group', { name: 'Orrery view' })).toBeVisible();
	const first = await nameBox();
	await expect.poll(nameBox, { timeout: 8000 }).not.toBe(first);

	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.waitForTimeout(300);
	const held = await nameBox();
	await page.waitForTimeout(1200);
	expect(await nameBox()).toBe(held);
});
