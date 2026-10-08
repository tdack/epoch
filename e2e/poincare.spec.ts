/**
 * The Ball view: a WebGL scene with the focus line named in the DOM over it. The spheres are not
 * in the accessibility tree, so this drives the names and the camera controls, and clicks a sphere
 * through its name's position, as the rings spec does.
 */
import { expect, open, test } from './support';

test('ball opens from the address, names the focus line and refocuses from a name', async ({
	api,
	page
}) => {
	const gran = await api.addPerson('Gran', 'Poincare', { birthDate: '1900', deathDate: '1980' });
	const mum = await api.addPerson('Mum', 'Poincare', { birthDate: '1930', deathDate: '2000' });
	const dad = await api.addPerson('Dad', 'Poincare', { birthDate: '1928', deathDate: '1999' });
	const me = await api.addPerson('Me', 'Poincare', { birthDate: '1960' });
	const sib = await api.addPerson('Sib', 'Poincare', { birthDate: '1962' });
	await api.child(gran, mum);
	await api.partner(mum, dad);
	await api.child(mum, me);
	await api.child(mum, sib);

	await open(page, `/trees/${api.treeId}?focus=${encodeURIComponent(me.id)}&mode=poincare`);
	const ball = page.getByRole('group', { name: 'Ball view' });
	await expect(ball).toBeVisible();
	await expect(
		page.getByRole('group', { name: 'Layout' }).getByRole('button', { name: '3D · Ball' })
	).toHaveAttribute('aria-pressed', 'true');
	const name = (given: string) =>
		ball.getByRole('button', { name: new RegExp(`^${given} Poincare\\b`) });

	// The focus line is named; a sibling and a parent's partner are not, until asked.
	for (const given of ['Gran', 'Mum', 'Me']) await expect(name(given)).toBeVisible();
	await expect(name('Sib')).toHaveCount(0);
	await expect(name('Dad')).toHaveCount(0);
	await expect(ball.getByTestId('ball-no-dates')).toHaveCount(0);
	await ball.getByRole('button', { name: 'All names' }).click();
	await expect(name('Sib')).toBeVisible();

	// A name refocuses the Ball on that person; Shift+Enter opens their details.
	await name('Mum').click();
	await expect(page).toHaveURL(new RegExp(`focus=${mum.id}`));
	await expect(page).toHaveURL(/mode=poincare/);
	await name('Gran').focus();
	await page.keyboard.press('Shift+Enter');
	await expect(page).toHaveURL(new RegExp(`person=${gran.id}`));
	await page.keyboard.press('Escape');
	await expect(page).not.toHaveURL(/person=/);

	// The presets change the view without touching the address.
	const before = page.url();
	for (const preset of ['Pole', 'Side']) {
		await ball.getByRole('button', { name: preset }).click();
		await expect(ball.getByRole('button', { name: preset })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
	}
	expect(page.url()).toBe(before);

	// Clicking the sphere under a name picks that person, through the WebGL scene. From the side the
	// oldest person stands alone at the top, so nothing is in front of her sphere. A miss lands
	// elsewhere, so the step is retried from a fresh reading of the name's position.
	await expect(async () => {
		await page.evaluate(
			() =>
				new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null))))
		);
		const box = (await name('Gran').boundingBox())!;
		await page.mouse.click(box.x + box.width / 2, box.y + box.height + 10);
		await expect(page).toHaveURL(new RegExp(`focus=${gran.id}`), { timeout: 2000 });
	}).toPass({ timeout: 15000 });
});

test('a tree with no dates says so and shows no years', async ({ api, page }) => {
	const mum = await api.addPerson('Mum', 'Undated');
	const me = await api.addPerson('Me', 'Undated');
	await api.child(mum, me);

	await open(page, `/trees/${api.treeId}?focus=${encodeURIComponent(me.id)}&mode=poincare`);
	const ball = page.getByRole('group', { name: 'Ball view' });
	await expect(ball.getByRole('button', { name: /^Me Undated\b/ })).toBeVisible();
	await expect(ball.getByTestId('ball-no-dates')).toBeVisible();
});
