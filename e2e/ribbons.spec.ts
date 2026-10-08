/**
 * The Ribbons view: lineages as tubes meeting at union knots, in WebGL, with the focus line named
 * in the DOM over the scene. The tubes are not in the accessibility tree, so this drives the names
 * and the camera controls, and clicks a node through its name's position.
 */
import { expect, open, test } from './support';

test('ribbons opens from the address, names the focus line and refocuses on a click in the scene', async ({
	api,
	page
}) => {
	const gran = await api.addPerson('Gran', 'Ribbons', { birthDate: '1900', deathDate: '1980' });
	const mum = await api.addPerson('Mum', 'Ribbons', { birthDate: '1930', deathDate: '2000' });
	const dad = await api.addPerson('Dad', 'Ribbons', { birthDate: '1928', deathDate: '1999' });
	const me = await api.addPerson('Me', 'Ribbons', { birthDate: '1960' });
	const sib = await api.addPerson('Sib', 'Ribbons', { birthDate: '1962' });
	await api.child(gran, mum);
	await api.partner(mum, dad);
	await api.child(mum, me);
	await api.child(mum, sib);

	const view = page.getByRole('group', { name: 'Ribbons view' });
	const name = (given: string) =>
		view.getByRole('button', { name: new RegExp(`^${given} Ribbons\\b`) });

	await open(
		page,
		`/trees/${api.treeId}?focus=${encodeURIComponent(me.id)}&mode=ribbons&up=3&down=3`
	);
	await expect(view).toBeVisible();
	await expect(
		page.getByRole('group', { name: 'Layout' }).getByRole('button', { name: '3D · Ribbons' })
	).toHaveAttribute('aria-pressed', 'true');

	// The focus line is named; a sibling and a parent's partner are not, until asked.
	for (const given of ['Gran', 'Mum', 'Me']) await expect(name(given)).toBeVisible();
	await expect(name('Sib')).toHaveCount(0);
	await expect(name('Dad')).toHaveCount(0);
	await view.getByRole('button', { name: 'All names' }).click();
	await expect(name('Sib')).toBeVisible();
	await expect(name('Dad')).toBeVisible();

	// The camera presets change the view without touching the address.
	const before = page.url();
	await view.getByRole('button', { name: 'Edge' }).click();
	await expect(view.getByRole('button', { name: 'Edge' })).toHaveAttribute('aria-pressed', 'true');
	expect(page.url()).toBe(before);
	await view.getByRole('button', { name: 'Side' }).click();

	// Clicking the node under a name picks that person, through the WebGL scene. Names follow the
	// scene a frame behind, so read the position after two frames, and retry from a fresh reading.
	await expect(async () => {
		await page.evaluate(
			() =>
				new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null))))
		);
		const box = (await name('Gran').boundingBox())!;
		// The name sits 10px above its node's centre.
		await page.mouse.click(box.x + box.width / 2, box.y + box.height + 10);
		await expect(page).toHaveURL(new RegExp(`focus=${gran.id}`), { timeout: 2000 });
	}).toPass({ timeout: 15000 });
	await expect(page).toHaveURL(/mode=ribbons/);

	// Shift+Enter on a name opens the details; Escape clears them.
	await name('Mum').focus();
	await page.keyboard.press('Shift+Enter');
	await expect(page).toHaveURL(new RegExp(`person=${mum.id}`));
});
