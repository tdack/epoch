/**
 * The Ribbons view: lineages as tubes meeting at union knots, in WebGL, with the focus line named
 * in the DOM over the scene. The tubes are not in the accessibility tree, so this drives the names
 * and the camera controls, and clicks a node through its name's position.
 */
import { activate, clickPick, expect, open, pickPoint, test } from './support';

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

/** Gran and Gran2 had Mum; Mum and Dad had Me and Sib. */
async function family(api: Parameters<Parameters<typeof test>[2]>[0]['api'], tag: string) {
	const gran = await api.addPerson('Gran', tag);
	const gran2 = await api.addPerson('Gran2', tag);
	const mum = await api.addPerson('Mum', tag);
	const dad = await api.addPerson('Dad', tag);
	const me = await api.addPerson('Me', tag);
	const sib = await api.addPerson('Sib', tag);
	await api.partner(gran, gran2);
	await api.child(gran, mum);
	await api.partner(mum, dad);
	await api.child(mum, me);
	await api.child(mum, sib);
	const graph = await api.graph(me.id);
	const unionOf = (a: { id: string }, b: { id: string }) =>
		graph.unions.find((u) => u.partnerIds.includes(a.id) && u.partnerIds.includes(b.id))!.id;
	return {
		gran,
		gran2,
		mum,
		dad,
		me,
		sib,
		grans: unionOf(gran, gran2),
		parents: unionOf(mum, dad)
	};
}

test('a knot and a tube can be picked through the merged meshes, and trace marks where paths meet', async ({
	api,
	page
}) => {
	const f = await family(api, 'Pick');
	const view = page.getByRole('group', { name: 'Ribbons view' });
	const name = (given: string) =>
		view.getByRole('button', { name: new RegExp(`^${given} Pick\\b`) });
	const status = view.locator('p[aria-live]');

	await open(page, `/trees/${api.treeId}?focus=${encodeURIComponent(f.me.id)}&mode=ribbons`);
	await expect(name('Me')).toBeVisible();
	await expect(name('Dad')).toHaveCount(0);

	// From the side the siblings' tubes fan apart instead of lying one behind the other.
	await view.getByRole('button', { name: 'Side' }).click();

	// A knot is the partnership's marker: clicking it lights both partners, and the focus stays put.
	const before = page.url();
	await clickPick(page, view, 'union', f.parents);
	await expect(status).toContainText('Selected the partnership of Mum Pick and Dad Pick');
	await expect(name('Dad')).toBeVisible();
	await expect(name('Gran')).toBeVisible();
	expect(page.url()).toBe(before);

	// A tube: the child and what is downstream, and the parent above; Dad is not on Gran's line.
	await clickPick(page, view, 'link', f.sib.id, { isPrefix: true });
	await expect(status).toContainText('Selected the line to Sib Pick');
	await expect(name('Sib')).toBeVisible();
	await expect(name('Mum')).toBeVisible();
	expect(page.url()).toBe(before);

	// Hovering a knot says what it is.
	const at = await pickPoint(view, 'union', f.parents);
	await page.mouse.move(at.x, at.y);
	await expect(view.getByTestId('hover-card')).toContainText(
		'Partnership of Mum Pick and Dad Pick'
	);

	// Trace: a person and a knot meet where Gran's kin are also Mum and Dad's.
	await page.keyboard.press('Escape');
	await view.getByRole('button', { name: 'All names' }).click();
	await view.getByRole('button', { name: 'Trace', exact: true }).click();
	await activate(name('Gran'));
	await clickPick(page, view, 'union', f.parents);
	await expect(view.getByTestId('trace-chip')).toHaveCount(2);
	await expect(status).toContainText('on more than one path');
});

test('the whole tree flows from the oldest row down, and a person lights their line in place', async ({
	api,
	page
}) => {
	const gran = await api.addPerson('Gran', 'Whole', { birthDate: '1900', deathDate: '1980' });
	const mum = await api.addPerson('Mum', 'Whole', { birthDate: '1930', deathDate: '2000' });
	const me = await api.addPerson('Me', 'Whole', { birthDate: '1960' });
	await api.child(gran, mum);
	await api.child(mum, me);
	const max = await api.addPerson('Max', 'Marrow', { birthDate: '1905', deathDate: '1970' });
	const moe = await api.addPerson('Moe', 'Marrow', { birthDate: '1935', deathDate: '2001' });
	await api.child(max, moe);

	const view = page.getByRole('group', { name: 'Ribbons view' });
	const name = (given: string, surname: string) =>
		view.getByRole('button', { name: new RegExp(`^${given} ${surname}\\b`) });

	await open(page, `/trees/${api.treeId}?focus=${encodeURIComponent(me.id)}&mode=ribbons`);
	await view.getByRole('button', { name: 'All names' }).click();
	await expect(name('Max', 'Marrow')).toHaveCount(0);
	await view.getByRole('button', { name: 'Whole tree' }).click();
	await expect(page).toHaveURL(/scope=all/);
	await expect(name('Max', 'Marrow')).toBeVisible();
	await expect(name('Me', 'Whole')).toBeVisible();
	await expect(view.getByRole('button', { name: 'Focus line' })).toHaveCount(0);

	// Older rows are higher on the screen, whichever family they belong to.
	const top = async (given: string, surname: string) =>
		(await name(given, surname).boundingBox())!.y;
	await expect
		.poll(async () => (await top('Gran', 'Whole')) < (await top('Me', 'Whole')))
		.toBe(true);

	const urlBefore = page.url();
	await activate(name('Mum', 'Whole'));
	await expect(view.locator('p[aria-live]')).toContainText('Selected Mum Whole');
	expect(page.url()).toBe(urlBefore);
});
