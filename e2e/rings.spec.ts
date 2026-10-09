/**
 * The rings overview (ADR-032): one ring per generation in WebGL, with the focus person's line
 * named in the DOM over the scene. The spheres are not in the accessibility tree, so these tests
 * drive the names and the camera controls, and click a sphere through its name's position.
 */
import { activate, clickPick, expect, open, pickPoint, test } from './support';

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

	// Clicking the sphere under a name picks that person, through the WebGL scene. From the side
	// Gran stands alone on the bottom ring, so nothing else is in front of her sphere.
	await page.keyboard.press('Escape');
	// Closing the drawer is a navigation of its own; a click during it would be overtaken.
	await expect(page).not.toHaveURL(/person=/);
	await rings.getByRole('button', { name: 'Side' }).click();
	// Names follow the scene a frame behind the camera, and frames are drawn only when something
	// moved, so read Gran's name after two frames have passed. A miss lands on someone else, so the
	// whole step is retried from a fresh reading.
	// Hovering a sphere shows its card: recorded facts only, beside the pointer.
	await expect(async () => {
		await page.evaluate(
			() =>
				new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null))))
		);
		const box = (await name('Gran').boundingBox())!;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height + 10);
		await expect(rings.getByTestId('hover-card')).toContainText('Gran', { timeout: 2000 });
	}).toPass({ timeout: 15000 });
	await expect(rings.getByTestId('hover-card')).toContainText('Ancestor');
	await expect(async () => {
		await page.evaluate(
			() =>
				new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null))))
		);
		const box = (await name('Gran').boundingBox())!;
		// The name sits 10px above its sphere's centre.
		await page.mouse.click(box.x + box.width / 2, box.y + box.height + 10);
		await expect(page).toHaveURL(new RegExp(`focus=${gran.id}`), { timeout: 2000 });
	}).toPass({ timeout: 15000 });

	// Back to flat keeps the focus.
	await mode('Flat').click();
	await expect(page).toHaveURL(/mode=flat/);
	await expect(page).toHaveURL(new RegExp(`focus=${gran.id}`));
});

test('clearing the highlight keeps everyone in place, and a name or the switch lights it again', async ({
	api,
	page
}) => {
	const mum = await api.addPerson('Mum', 'Quiet');
	const me = await api.addPerson('Me', 'Quiet');
	await api.child(mum, me);
	const rings = page.getByRole('group', { name: 'Generation rings' });
	const name = (given: string) =>
		rings.getByRole('button', { name: new RegExp(`^${given} Quiet\\b`) });
	const focusLine = rings.getByRole('button', { name: 'Focus line' });

	await open(page, `/trees/${api.treeId}?focus=${encodeURIComponent(me.id)}&mode=rings`);
	await expect(name('Mum')).toBeVisible();
	await expect(focusLine).toHaveAttribute('aria-pressed', 'true');
	const before = page.url();

	// Empty space, away from the legend and the controls: nothing is under it.
	const box = (await rings.boundingBox())!;
	await page.mouse.click(box.x + box.width - 24, box.y + 72);
	await expect(focusLine).toHaveAttribute('aria-pressed', 'false');
	await expect(name('Mum')).toHaveCount(0);
	expect(page.url()).toBe(before);

	// The switch lights the line again; Escape clears it when no drawer is open.
	await focusLine.click();
	await expect(name('Mum')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(focusLine).toHaveAttribute('aria-pressed', 'false');

	// "All names" still reaches everyone, and a name refocuses and lights the line.
	await rings.getByRole('button', { name: 'All names' }).click();
	await name('Mum').click();
	await expect(page).toHaveURL(new RegExp(`focus=${mum.id}`));
	await expect(focusLine).toHaveAttribute('aria-pressed', 'true');
});

/** Gran and Gran2 had Mum; Mum and Dad had Me and Sib. Names carry a tag so one tree's text is unique. */
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

test('a partnership and a line can be selected in the scene, and Escape and empty space clear them', async ({
	api,
	page
}) => {
	const f = await family(api, 'Pick');
	const rings = page.getByRole('group', { name: 'Generation rings' });
	const name = (given: string) =>
		rings.getByRole('button', { name: new RegExp(`^${given} Pick\\b`) });
	const status = rings.locator('p[aria-live]');

	// Focused on Gran2 (a partner, no parents), the line lights only Gran2's own partner and kin.
	await open(page, `/trees/${api.treeId}?focus=${encodeURIComponent(f.me.id)}&mode=rings`);
	await expect(name('Me')).toBeVisible();
	await expect(name('Dad')).toHaveCount(0);

	// A partnership: its partners and everything above and below light, and the focus stays put.
	const before = page.url();
	await clickPick(page, rings, 'union', f.parents);
	await expect(status).toContainText('Selected the partnership of Mum Pick and Dad Pick');
	await expect(name('Dad')).toBeVisible();
	await expect(name('Gran')).toBeVisible();
	await expect(name('Sib')).toBeVisible();
	expect(page.url()).toBe(before);

	// A line: the child and their descendants, and the parents above; Dad is not on Gran's line.
	await clickPick(page, rings, 'link', f.sib.id, { isPrefix: true });
	await expect(status).toContainText('Selected the line to Sib Pick');
	await expect(name('Sib')).toBeVisible();
	await expect(name('Mum')).toBeVisible();
	expect(page.url()).toBe(before);

	// Hovering a partnership says what it is.
	const at = await pickPoint(rings, 'union', f.parents);
	await page.mouse.move(at.x, at.y);
	await expect(rings.getByTestId('hover-card')).toContainText(
		'Partnership of Mum Pick and Dad Pick'
	);

	// Escape clears it (no drawer is open), and the focus line comes back from the switch.
	await page.keyboard.press('Escape');
	await expect(status).toContainText('Highlight cleared');
	await rings.getByRole('button', { name: 'Focus line' }).click();
	await expect(status).not.toContainText('Highlight cleared');
});

test('trace mode adds and removes people, partnerships and lines, marks where they meet, and holds six', async ({
	api,
	page
}) => {
	const f = await family(api, 'Trace');
	const extra = [];
	// Aunts and uncles: drawn with the wider groups, and enough people to pass the cap.
	for (const given of ['Aa', 'Bb', 'Cc', 'Dd', 'Ee']) {
		const aunt = await api.addPerson(given, 'Trace');
		await api.child(f.gran, aunt);
		extra.push(aunt);
	}
	const rings = page.getByRole('group', { name: 'Generation rings' });
	const name = (given: string) =>
		rings.getByRole('button', { name: new RegExp(`^${given} Trace\\b`) });
	const status = rings.locator('p[aria-live]');
	const strip = rings.getByTestId('trace-strip');
	const trace = rings.getByRole('button', { name: 'Trace', exact: true });

	await open(page, `/trees/${api.treeId}?focus=${encodeURIComponent(f.me.id)}&mode=rings`);
	await rings.getByRole('button', { name: 'All names' }).click();
	await expect(name('Me')).toBeVisible();
	await expect(trace).toHaveAttribute('aria-pressed', 'false');
	await expect(strip).toHaveCount(0);

	// Off by default; turning it on starts clean, and a name now adds instead of refocusing.
	await trace.click();
	await expect(strip).toBeVisible();
	await expect(rings.getByTestId('trace-count')).toHaveText('0 of 6');
	const before = page.url();
	await activate(name('Gran'));
	await expect(rings.getByTestId('trace-chip')).toHaveCount(1);
	expect(page.url()).toBe(before);

	// A partnership joins, and where the two paths meet is said: Gran's kin are also Mum and Dad's.
	await clickPick(page, rings, 'union', f.parents);
	await expect(rings.getByTestId('trace-chip')).toHaveCount(2);
	await expect(rings.getByTestId('trace-count')).toHaveText('2 of 6');
	await expect(status).toContainText('on more than one path');

	// A line joins; clicking an item's name again, or its chip's remove button, takes it off.
	await clickPick(page, rings, 'link', f.sib.id, { isPrefix: true });
	await expect(rings.getByTestId('trace-chip')).toHaveCount(3);
	await activate(name('Gran'));
	await expect(rings.getByTestId('trace-chip')).toHaveCount(2);
	await rings.getByRole('button', { name: /^Remove .*Sib Trace.* from the trace$/ }).click();
	await expect(rings.getByTestId('trace-chip')).toHaveCount(1);

	// Six, and a seventh adds nothing and says so.
	for (const given of ['Aa', 'Bb', 'Cc', 'Dd', 'Ee']) await activate(name(given));
	await expect(rings.getByTestId('trace-count')).toHaveText('6 of 6');
	await activate(name('Sib'));
	await expect(rings.getByTestId('trace-count')).toHaveText('6 of 6');
	await expect(strip).toContainText('Trace holds at most 6 items');
	await expect(status).toContainText('Trace holds at most 6 items');

	// Escape ends trace mode (dropping the items); the next press clears the highlight.
	await page.keyboard.press('Escape');
	await expect(trace).toHaveAttribute('aria-pressed', 'false');
	await expect(strip).toHaveCount(0);
	await page.keyboard.press('Escape');
	await expect(status).toContainText('Highlight cleared');
	expect(extra).toHaveLength(5);
});
