/**
 * The rings overview (ADR-032): one ring per generation in WebGL, with the focus person's line
 * named in the DOM over the scene. The spheres are not in the accessibility tree, so these tests
 * drive the names and the camera controls, and click a sphere through its name's position.
 */
import { expect, open, test } from './support';

test('rings opens from the toolbar, asks for more generations, and refocuses from a name', async ({
	api,
	page
}) => {
	const gran = await api.addPerson('Gran', 'Rings', { birthDate: '1900', deathDate: '1980' });
	const mum = await api.addPerson('Mum', 'Rings', { birthDate: '1930', deathDate: '2000' });
	const dad = await api.addPerson('Dad', 'Rings', { birthDate: '1928', deathDate: '1999' });
	const me = await api.addPerson('Me', 'Rings', { birthDate: '1960' });
	const sib = await api.addPerson('Sib', 'Rings', { birthDate: '1962' });
	const kid = await api.addPerson('Kid', 'Rings', { birthDate: '1990' });
	await api.child(gran, mum);
	await api.partner(mum, dad);
	await api.child(mum, me);
	await api.child(mum, sib);
	await api.child(me, kid);

	const mode = (name: string) =>
		page.getByRole('group', { name: 'Layout' }).getByRole('button', { name });
	const rings = page.getByRole('group', { name: 'Generation rings' });
	const name = (given: string) =>
		rings.getByRole('button', { name: new RegExp(`^${given} Rings\\b`) });

	await open(page, `/trees/${api.treeId}?focus=${encodeURIComponent(me.id)}`);
	await expect(mode('Rings')).toBeVisible();
	await mode('Rings').click();
	await expect(page).toHaveURL(/mode=rings/);
	// The overview asks for five generations each way, unless more were already set.
	await expect(page).toHaveURL(/up=5/);
	await expect(page).toHaveURL(/down=5/);
	await expect(rings).toBeVisible();
	await expect(mode('Rings')).toHaveAttribute('aria-pressed', 'true');

	// The focus line is named: ancestors and descendants. A sibling, and a parent's partner who is
	// not a parent, are not, until asked.
	for (const given of ['Gran', 'Mum', 'Me', 'Kid']) await expect(name(given)).toBeVisible();
	await expect(name('Sib')).toHaveCount(0);
	await expect(name('Dad')).toHaveCount(0);
	await rings.getByRole('button', { name: 'All names' }).click();
	await expect(name('Sib')).toBeVisible();

	// A name refocuses the rings on that person; Shift+Enter opens their details.
	await name('Kid').click();
	await expect(page).toHaveURL(new RegExp(`focus=${kid.id}`));
	await expect(page).toHaveURL(/mode=rings/);
	await name('Mum').focus();
	await page.keyboard.press('Shift+Enter');
	await expect(page).toHaveURL(new RegExp(`person=${mum.id}`));

	// The camera presets change the view without touching the address.
	const before = page.url();
	await rings.getByRole('button', { name: 'Above' }).click();
	await expect(rings.getByRole('button', { name: 'Above' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	expect(page.url()).toBe(before);

	// Clicking the sphere under a name picks that person, through the WebGL scene. Gran's name is
	// the only one near her sphere from above, so the click cannot land on another name.
	await page.keyboard.press('Escape');
	const box = (await name('Gran').boundingBox())!;
	// The name sits 10px above its sphere's centre.
	await page.mouse.click(box.x + box.width / 2, box.y + box.height + 10);
	await expect(page).toHaveURL(new RegExp(`focus=${gran.id}`));

	// Back to flat keeps the focus.
	await mode('Flat').click();
	await expect(page).toHaveURL(/mode=flat/);
	await expect(page).toHaveURL(new RegExp(`focus=${gran.id}`));
});
