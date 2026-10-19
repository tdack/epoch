/**
 * The whole tree (`scope=all`): everyone the viewer may see, anchored to no one, in the WebGL
 * views and Flat. In a WebGL view a person lights their line in place and nothing refetches; in
 * Flat a card leads back into the focus view. A restricted viewer is never sent a private person.
 * Privacy lives here, not in privacy.spec.ts, so that file stays untouched.
 */
import { activate, expect, open, test } from './support';

const PORT = Number(process.env.E2E_PORT ?? 5179);

test('the whole tree draws unconnected families, lights a line in place and leaves cleanly', async ({
	api,
	page
}) => {
	const gran = await api.addPerson('Gran', 'Whole', { birthDate: '1900', deathDate: '1980' });
	const mum = await api.addPerson('Mum', 'Whole', { birthDate: '1930', deathDate: '2000' });
	const me = await api.addPerson('Me', 'Whole', { birthDate: '1960' });
	await api.child(gran, mum);
	await api.child(mum, me);
	// Nothing links the Marrows to the Wholes: only the whole tree shows them together.
	const max = await api.addPerson('Max', 'Marrow', { birthDate: '1905', deathDate: '1970' });
	const moe = await api.addPerson('Moe', 'Marrow', { birthDate: '1935', deathDate: '2001' });
	await api.child(max, moe);

	const rings = page.getByRole('group', { name: 'Generation rings' });
	const name = (given: string, surname: string) =>
		rings.getByRole('button', { name: new RegExp(`^${given} ${surname}\\b`) });
	const wholeButton = rings.getByRole('button', { name: 'Whole tree' });
	const graphRequests: string[] = [];
	page.on('request', (r) => {
		if (r.url().includes('/graph')) graphRequests.push(r.url());
	});

	await open(page, `/trees/${api.treeId}?focus=${encodeURIComponent(me.id)}&mode=rings`);
	await expect(rings).toBeVisible();
	await expect(wholeButton).toHaveAttribute('aria-pressed', 'false');
	await rings.getByRole('button', { name: 'All names' }).click();
	await expect(name('Max', 'Marrow')).toHaveCount(0);

	// Entering the whole tree: no focus in the request, the Marrows appear, nobody is the focus.
	await wholeButton.click();
	await expect(page).toHaveURL(/scope=all/);
	await expect(wholeButton).toHaveAttribute('aria-pressed', 'true');
	await expect(name('Max', 'Marrow')).toBeVisible();
	await expect(name('Me', 'Whole')).toBeVisible();
	expect(graphRequests.at(-1)).toContain('scope=all');
	expect(graphRequests.at(-1)).not.toContain('focus=');
	await expect(rings.getByRole('button', { name: 'Focus line' })).toHaveCount(0);
	await expect(rings.locator('p[aria-live]')).toContainText('the whole tree');
	// The steppers are disabled, with a note why.
	await expect(page.getByRole('button', { name: 'Fewer ancestors generations' })).toBeDisabled();
	await expect(page.getByText('The whole tree shows every generation.').first()).toBeVisible();

	// A person lights their line where they stand: no refetch, and the address keeps its focus.
	const requestsBefore = graphRequests.length;
	const urlBefore = page.url();
	await activate(name('Mum', 'Whole'));
	await expect(rings.locator('p[aria-live]')).toContainText('Selected Mum Whole');
	await expect(rings.locator('p[aria-live]')).toContainText('1 ancestors and 1 descendants');
	expect(page.url()).toBe(urlBefore);
	expect(graphRequests.length).toBe(requestsBefore);

	// Leaving by the button returns to the focus view, at the focus the address kept.
	await wholeButton.click();
	await expect(page).not.toHaveURL(/scope=all/);
	await expect(page).toHaveURL(new RegExp(`focus=${me.id}`));
	await expect(wholeButton).toHaveAttribute('aria-pressed', 'false');
	await expect(name('Max', 'Marrow')).toHaveCount(0);

	// Flat draws the whole tree too, both families side by side.
	await wholeButton.click();
	await expect(page).toHaveURL(/scope=all/);
	await page.getByRole('group', { name: 'Layout' }).getByRole('button', { name: 'Flat' }).click();
	await expect(page).toHaveURL(/mode=flat/);
	await expect(page).toHaveURL(/scope=all/);
	const flatWhole = page.getByRole('button', { name: 'Whole tree' });
	await expect(flatWhole).toHaveAttribute('aria-pressed', 'true');
	const card = (given: string, surname: string) =>
		page.getByRole('button', { name: new RegExp(`^${given} ${surname}\\b`) });
	await expect(card('Max', 'Marrow')).toBeVisible();
	await expect(card('Gran', 'Whole')).toBeVisible();

	// A card there is the way in: it focuses that person and leaves the whole tree.
	await card('Moe', 'Marrow').click();
	await expect(page).not.toHaveURL(/scope=all/);
	await expect(page).toHaveURL(new RegExp(`focus=${moe.id}`));
	await expect(flatWhole).toHaveAttribute('aria-pressed', 'false');
	await expect(card('Gran', 'Whole')).toHaveCount(0);
});

test('a restricted viewer is never sent a private person by the whole tree', async ({
	api,
	page,
	browser,
	request
}) => {
	test.setTimeout(90_000);
	const sub = `e2e-whole-${Date.now()}`;
	const olda = await api.addPerson('Olda', 'Wholeman', { birthDate: '1850', deathDate: '1920' });
	const kitt = await api.addPerson('Kitt', 'Wholeman', { birthDate: '1880', deathDate: '1950' });
	const livia = await api.addPerson('Livia', 'Secretson', { birthDate: '1990' });
	await api.child(olda, kitt);
	await api.child(kitt, livia);
	// Unconnected, and living: a private person with no relative to be reached through.
	await api.addPerson('Stran', 'Livingson', { birthDate: '1999' });

	const identity = {
		'x-dev-user-sub': sub,
		'x-dev-user-email': `${sub}@epoch.test`,
		'x-dev-user-name': 'Vera Viewer'
	};
	const viewerContext = await browser.newContext({ extraHTTPHeaders: identity });
	await viewerContext.addCookies(
		Object.entries(identity).map(([name, value]) => ({
			name,
			value: encodeURIComponent(value),
			url: `http://localhost:${PORT}`
		}))
	);
	try {
		const invited = await request.post(`/api/trees/${api.treeId}/invitations`, {
			data: { email: identity['x-dev-user-email'], role: 'viewer' }
		});
		expect(invited.status()).toBe(201);
		expect((await viewerContext.request.get(`/trees/${api.treeId}/people`)).ok()).toBe(true);

		// The API: the dead are there, the living are in no field of the answer.
		const answer = await viewerContext.request.get(`/api/trees/${api.treeId}/graph?scope=all`);
		expect(answer.ok()).toBe(true);
		const text = await answer.text();
		expect(text).toContain('Olda');
		expect(text).toContain('Kitt');
		for (const secret of ['Livia', 'Secretson', 'Stran', 'Livingson', livia.id])
			expect(text, secret).not.toContain(secret);
		const body = JSON.parse(text);
		expect(body).toMatchObject({ isWholeTree: true, isTruncated: false, focusPersonId: null });

		// The page: no name button for them, with every name asked for.
		const viewer = await viewerContext.newPage();
		await open(viewer, `/trees/${api.treeId}?mode=rings&scope=all`);
		const rings = viewer.getByRole('group', { name: 'Generation rings' });
		await expect(rings).toBeVisible();
		await rings.getByRole('button', { name: 'All names' }).click();
		await expect(rings.getByRole('button', { name: /^Olda Wholeman\b/ })).toBeVisible();
		await expect(rings.getByRole('button', { name: /^Kitt Wholeman\b/ })).toBeVisible();
		await expect(rings.getByRole('button', { name: /Livia|Stran/ })).toHaveCount(0);
		await expect(viewer.getByText('Secretson')).toHaveCount(0);

		// The owner sees them.
		await open(page, `/trees/${api.treeId}?mode=rings&scope=all`);
		const ownerRings = page.getByRole('group', { name: 'Generation rings' });
		await ownerRings.getByRole('button', { name: 'All names' }).click();
		await expect(ownerRings.getByRole('button', { name: /^Livia Secretson\b/ })).toBeVisible();
	} finally {
		await viewerContext.close();
	}
});
