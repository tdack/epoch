/**
 * The Orrery view: a WebGL star cluster with the focus line named in the DOM over it. The stars
 * are not in the accessibility tree, so these tests drive the names and the camera controls, and
 * click a star through its name's position.
 */
import type { Locator, Page } from '@playwright/test';
import { activate, clickPick, expect, open, pickPoint, test } from './support';

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
	// Gran is on the focus line, so she stays named; the others' names could cover her star.
	await orrery.getByRole('button', { name: 'All names' }).click();
	await expect(async () => {
		await page.evaluate(
			() =>
				new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null))))
		);
		const box = (await name('Gran').boundingBox())!;
		// The name sits 10px above its star's centre; click only where nothing covers the star.
		const at = { x: box.x + box.width / 2, y: box.y + box.height + 10 };
		expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, at)).toBe(
			'CANVAS'
		);
		await page.mouse.click(at.x, at.y);
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

test('the Motion switch holds the orrery still, and stays off after a reload', async ({
	api,
	page
}) => {
	const mum = await api.addPerson('Mum', 'Still');
	const dad = await api.addPerson('Dad', 'Still');
	const me = await api.addPerson('Me', 'Still');
	await api.partner(mum, dad);
	await api.child(mum, me);
	const orrery = page.getByRole('group', { name: 'Orrery view' });
	const nameBox = async () =>
		JSON.stringify(await orrery.getByRole('button', { name: /^Me Still\b/ }).boundingBox());

	await open(page, `/trees/${api.treeId}?focus=${encodeURIComponent(me.id)}&mode=orrery`);
	const motion = orrery.getByRole('button', { name: 'Motion' });
	await expect(motion).toHaveAttribute('aria-pressed', 'true');
	await motion.click();
	await expect(motion).toHaveAttribute('aria-pressed', 'false');
	await page.waitForTimeout(300);
	const held = await nameBox();
	await page.waitForTimeout(1200);
	expect(await nameBox()).toBe(held);

	await page.reload();
	await expect(orrery.getByRole('button', { name: 'Motion' })).toHaveAttribute(
		'aria-pressed',
		'false'
	);
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
	return { gran, gran2, mum, dad, me, sib, parents: unionOf(mum, dad) };
}

/**
 * Click a partnership marker or line once nothing lies over it. Names are real buttons over the
 * scene and stars drift, so a point read a moment ago can be under a name by the time it is
 * clicked; that is a miss by the test, not by the app.
 */
async function clickPickWhenClear(
	page: Page,
	orrery: Locator,
	kind: 'union' | 'link',
	id: string,
	options: { isPrefix?: boolean } = {}
) {
	// Held still, a name can cover the target for good; turning the camera moves it out from under.
	const presets = ['Side', 'Angled'];
	for (let attempt = 0; attempt < 8; attempt++) {
		const at = await pickPoint(orrery, kind, id, options);
		const isClear = await page.evaluate(
			({ x, y }) => document.elementFromPoint(x, y)?.tagName === 'CANVAS',
			at
		);
		if (isClear) return clickPick(page, orrery, kind, id, options);
		await orrery.getByRole('button', { name: presets[attempt % 2], exact: true }).click();
		await page.waitForTimeout(400);
	}
	throw new Error(`Nothing left the ${kind} ${id} clear to click`);
}

// The markers and lines must be hit where they are drawn now, not where the layout put them, so the
// next test checks a marker's target while the stars drift; the trace test keeps motion on.
test('a partnership and a line can be picked, and a marker target follows the drift', async ({
	api,
	page
}) => {
	const f = await family(api, 'Pick');
	const orrery = page.getByRole('group', { name: 'Orrery view' });
	const name = (given: string) =>
		orrery.getByRole('button', { name: new RegExp(`^${given} Pick\\b`) });
	const status = orrery.locator('p[aria-live]');

	await open(page, `/trees/${api.treeId}?focus=${encodeURIComponent(f.me.id)}&mode=orrery`);
	await expect(name('Me')).toBeVisible();
	await expect(name('Dad')).toHaveCount(0);

	// Clicks hold the orrery still: in a headless browser a frame can take long enough for a moving
	// marker to leave the point read for it, which says nothing about the app.
	const motion = orrery.getByRole('button', { name: 'Motion' });
	await motion.click();
	await expect(motion).toHaveAttribute('aria-pressed', 'false');
	// Clear the focus line so only the picked partnership is named, leaving the marker clear.
	await orrery.getByRole('button', { name: 'Focus line' }).click();
	const before = page.url();
	await clickPickWhenClear(page, orrery, 'union', f.parents);
	await expect(status).toContainText('Selected the partnership of Mum Pick and Dad Pick');
	await expect(name('Dad')).toBeVisible();
	await expect(name('Gran')).toBeVisible();
	await expect(name('Sib')).toBeVisible();
	expect(page.url()).toBe(before);

	await clickPickWhenClear(page, orrery, 'link', f.sib.id, { isPrefix: true });
	await expect(status).toContainText('Selected the line to Sib Pick');
	await expect(name('Sib')).toBeVisible();
	await expect(name('Mum')).toBeVisible();
	expect(page.url()).toBe(before);

	// With motion back on, the marker's hit target moves with the stars. It can drift off the point
	// between reading it and the pointer arriving, so a miss is retried from a fresh reading.
	await motion.click();
	const first = await pickPoint(orrery, 'union', f.parents);
	await expect(async () => {
		const at = await pickPoint(orrery, 'union', f.parents);
		expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, at)).toBe(
			'CANVAS'
		);
		await page.mouse.move(at.x, at.y);
		await expect(orrery.getByTestId('hover-card')).toContainText(
			'Partnership of Mum Pick and Dad Pick',
			{ timeout: 1000 }
		);
	}).toPass({ timeout: 20000 });
	await expect
		.poll(async () => JSON.stringify(await pickPoint(orrery, 'union', f.parents)), {
			timeout: 8000
		})
		.not.toBe(JSON.stringify(first));

	await page.keyboard.press('Escape');
	await expect(status).toContainText('Highlight cleared');
});

test('trace mode in the orrery marks where two paths meet', async ({ api, page }) => {
	const f = await family(api, 'Trace');
	const orrery = page.getByRole('group', { name: 'Orrery view' });
	const name = (given: string) =>
		orrery.getByRole('button', { name: new RegExp(`^${given} Trace\\b`) });
	const status = orrery.locator('p[aria-live]');
	const trace = orrery.getByRole('button', { name: 'Trace', exact: true });

	await open(page, `/trees/${api.treeId}?focus=${encodeURIComponent(f.me.id)}&mode=orrery`);
	await orrery.getByRole('button', { name: 'All names' }).click();
	await trace.click();
	await activate(name('Gran'));
	await expect(orrery.getByTestId('trace-chip')).toHaveCount(1);
	await clickPick(page, orrery, 'union', f.parents);
	await expect(orrery.getByTestId('trace-chip')).toHaveCount(2);
	await expect(status).toContainText('on more than one path');
	await clickPick(page, orrery, 'link', f.sib.id, { isPrefix: true });
	await expect(orrery.getByTestId('trace-chip')).toHaveCount(3);
	await page.keyboard.press('Escape');
	await expect(trace).toHaveAttribute('aria-pressed', 'false');
});

test('the whole tree in the orrery draws unconnected families and leaves cleanly', async ({
	api,
	page
}) => {
	const f = await family(api, 'Whole');
	const max = await api.addPerson('Max', 'Marrow', { birthDate: '1905' });
	const moe = await api.addPerson('Moe', 'Marrow', { birthDate: '1935' });
	await api.child(max, moe);
	const orrery = page.getByRole('group', { name: 'Orrery view' });
	const whole = orrery.getByRole('button', { name: 'Whole tree' });
	const marrow = (given: string) =>
		orrery.getByRole('button', { name: new RegExp(`^${given} Marrow\\b`) });

	await open(page, `/trees/${api.treeId}?focus=${encodeURIComponent(f.me.id)}&mode=orrery`);
	await orrery.getByRole('button', { name: 'All names' }).click();
	await expect(marrow('Max')).toHaveCount(0);
	await whole.click();
	await expect(page).toHaveURL(/scope=all/);
	await expect(marrow('Max')).toBeVisible();
	await expect(marrow('Moe')).toBeVisible();
	await expect(orrery.locator('p[aria-live]')).toContainText('the whole tree');
	// Partnerships and lines can still be picked with nobody as the focus. Every name is showing,
	// so hide them and hold the stars still to leave the marker clear.
	await orrery.getByRole('button', { name: 'All names' }).click();
	await orrery.getByRole('button', { name: 'Motion' }).click();
	await clickPickWhenClear(page, orrery, 'union', f.parents);
	await expect(orrery.locator('p[aria-live]')).toContainText('Selected the partnership');
	await whole.click();
	await expect(page).not.toHaveURL(/scope=all/);
	await expect(marrow('Max')).toHaveCount(0);
});
