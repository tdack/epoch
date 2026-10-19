import { expect, open, test } from './support';

/**
 * Sources, repositories and citations (ADR-028): a source is made while citing, cited from the
 * person page and from the tree's drawer, shown on its own page, and kept from a viewer who may not
 * see the people it supports.
 */

test('a source is made while citing a fact, cited again from the drawer, and listed on its page', async ({
	page,
	api
}) => {
	test.setTimeout(90_000);
	const wren = await api.addPerson('Wren', 'Ash', { birthDate: '4 MAR 1900', birthPlace: 'Leeds' });
	const base = `/trees/${api.treeId}`;

	// From the person page: open the birth's citations and cite a source made on the spot.
	await open(page, `${base}/people/${encodeURIComponent(wren.id)}`);
	const birth = page.getByTestId('fact').first();
	// An unsourced fact says nothing; the source is added while editing it.
	await expect(birth.getByTestId('claim-state')).toHaveCount(0);
	await expect(birth).not.toContainText('Unsourced');
	await birth.getByRole('button', { name: /^Edit/ }).click();
	const dialog = page.getByRole('dialog', { name: 'Edit fact' });
	await dialog.getByText('Source (optional)').click();
	await dialog.getByRole('button', { name: 'Make a new source…' }).click();
	await dialog.getByLabel('Title of the new source').fill('Parish register of St Mary');
	await dialog.getByRole('button', { name: 'Add this source' }).click();
	await expect(dialog.getByTestId('chosen-source')).toHaveText('Parish register of St Mary');
	await dialog.getByLabel('Where in it').fill('page 12');
	await dialog.getByLabel('How reliable is it').selectOption({ label: 'Direct, primary evidence' });
	await dialog.getByRole('button', { name: 'Save fact' }).click();
	await expect(dialog).toBeHidden();
	await expect(birth.getByTestId('claim-state')).toHaveText('1');
	await birth.getByLabel('1 citation for the birth').click();
	await expect(birth.getByTestId('citation')).toContainText('Parish register of St Mary');
	await expect(birth.getByTestId('citation')).toContainText('Direct, primary evidence');

	// From the drawer on the tree: the same fact, found by searching for the source.
	await page.goto(
		`${base}?focus=${encodeURIComponent(wren.id)}&person=${encodeURIComponent(wren.id)}`
	);
	const drawer = page.getByRole('complementary').or(page.locator('[data-testid="person-drawer"]'));
	await expect(drawer.getByRole('heading', { name: 'Wren Ash' }).first()).toBeVisible();
	const drawerBirth = drawer.getByTestId('fact').first();
	await drawerBirth.getByLabel('1 citation for the birth').click();
	await drawerBirth.getByRole('button', { name: 'Add a citation for the birth' }).click();
	const again = page.getByRole('dialog', { name: 'Add a citation' });
	await again.getByLabel('Search sources by title or author').fill('Parish');
	await again
		.getByTestId('source-results')
		.getByRole('option', { name: /Parish register/ })
		.click();
	await again.getByLabel('Where in it').fill('page 14');
	await again.getByRole('button', { name: 'Add citation', exact: true }).click();
	await expect(again).toBeHidden();
	await expect(drawerBirth.getByTestId('claim-state')).toHaveText('2');

	// The source's page lists both, grouped under what they support, and links to the person.
	await open(page, `${base}/sources`);
	const row = page.getByTestId('sources-list').getByRole('listitem').first();
	await expect(row).toContainText('Parish register of St Mary');
	await expect(row).toContainText('2 citations');
	await row.getByRole('link', { name: /Parish register/ }).click();
	await expect(page.getByTestId('source-title')).toHaveText('Parish register of St Mary');
	const group = page.getByTestId('source-group');
	await expect(group).toHaveCount(1);
	await expect(group).toContainText('the birth of Wren Ash');
	await expect(group).toContainText('page 12');
	await expect(group).toContainText('page 14');
	await group.getByRole('link', { name: 'the birth of Wren Ash' }).click();
	await expect(page.getByRole('heading', { name: 'Wren Ash' }).first()).toBeVisible();
});

test('a source can be edited, merged into another, and deleted with its citations, each undoable', async ({
	page,
	api,
	request
}) => {
	test.setTimeout(90_000);
	const wren = await api.addPerson('Wren', 'Ash', { birthDate: '4 MAR 1900' });
	const person = await (
		await request.get(`/api/trees/${api.treeId}/people/${encodeURIComponent(wren.id)}`)
	).json();
	const birthId = person.facts.find((f: { type: string }) => f.type === 'BIRT').id as string;
	const make = async (title: string) =>
		(await (await request.post(`/api/trees/${api.treeId}/sources`, { data: { title } })).json())
			.sourceId as string;
	const keep = await make('Parish register');
	const copy = await make('Parish register (copy)');
	for (const [sourceId, page] of [
		[keep, 'folio a'],
		[copy, 'folio b']
	] as const) {
		const res = await request.post(`/api/trees/${api.treeId}/citations`, {
			data: { subject: { kind: 'event', id: birthId }, sourceId, page }
		});
		expect(res.status(), await res.text()).toBe(201);
	}

	await open(page, `/trees/${api.treeId}/sources/${encodeURIComponent(keep)}`);
	await page.getByRole('button', { name: 'Edit', exact: true }).click();
	const edit = page.getByRole('dialog', { name: 'Edit source' });
	await edit.getByLabel('Author').fill('Rev A');
	await edit.getByRole('button', { name: 'Save source' }).click();
	await expect(edit).toBeHidden();
	await expect(page.getByText('Rev A')).toBeVisible();

	// Merging shows the exact change, and moves the other source's citation here.
	await page.getByRole('button', { name: 'Merge…' }).click();
	const merge = page.getByRole('dialog', { name: /Merge sources into/ });
	await merge.getByLabel('Find the duplicates').fill('copy');
	await merge.getByRole('checkbox').check();
	// The first request to the preview route compiles it in the dev server.
	await expect(merge.getByText(/None is lost/)).toBeVisible({
		timeout: 20_000
	});
	await merge.getByRole('button', { name: 'Merge sources' }).click();
	await expect(merge).toBeHidden();
	await expect(page.getByTestId('source-group')).toContainText('folio b');
	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(page.getByTestId('source-group')).not.toContainText('folio b');

	// Deleting a cited source says how many citations go with it.
	await page.getByRole('button', { name: 'Delete…' }).click();
	const confirm = page.getByRole('dialog', { name: /Delete “Parish register” and its 1 citation/ });
	await expect(confirm.getByText(/Citation of “Parish register”/)).toBeVisible();
	await confirm.getByRole('button', { name: 'Delete source and citations' }).click();
	await expect(page).toHaveURL(/\/sources$/);
});

test('a viewer never sees a private person’s citation, or the source that only they support', async ({
	api,
	page,
	browser,
	request
}) => {
	test.setTimeout(120_000);
	const sub = `e2e-viewer-${Date.now()}`;
	const old = await api.addPerson('Olda', 'Oldman', { birthDate: '1850', birthPlace: 'Cork' });
	const living = await api.addPerson('Livia', 'Aliveson', { birthDate: '1990' });
	const makeSource = async (title: string) =>
		(await (await request.post(`/api/trees/${api.treeId}/sources`, { data: { title } })).json())
			.sourceId as string;
	const census = await makeSource('Census 1851');
	const certificate = await makeSource('Birth certificate of Livia Aliveson');
	for (const [person, sourceId] of [
		[old, census],
		[living, certificate]
	] as const) {
		const res = await request.post(`/api/trees/${api.treeId}/citations`, {
			data: { subject: { kind: 'person', id: person.id }, sourceId, page: 'p 1' }
		});
		expect(res.status(), await res.text()).toBe(201);
	}

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
			url: 'http://localhost:5179'
		}))
	);
	try {
		const invited = await request.post(`/api/trees/${api.treeId}/invitations`, {
			data: { email: identity['x-dev-user-email'], role: 'viewer' }
		});
		expect(invited.status()).toBe(201);
		expect((await viewerContext.request.get(`/trees/${api.treeId}/people`)).ok()).toBe(true);

		const viewer = await viewerContext.newPage();
		const base = `/trees/${api.treeId}`;
		await open(viewer, `${base}/sources`);
		await expect(viewer.getByRole('link', { name: 'Census 1851' })).toBeVisible();
		await expect(viewer.getByText('Livia')).toHaveCount(0);
		await expect(viewer.getByText('Aliveson')).toHaveCount(0);

		// The source that only a private person supports answers like one that is not there.
		const hidden = await viewer.request.get(
			`/api/trees/${api.treeId}/sources/${encodeURIComponent(certificate)}`
		);
		const missing = await viewer.request.get(`/api/trees/${api.treeId}/sources/no-such-source`);
		expect(hidden.status()).toBe(404);
		expect(missing.status()).toBe(404);

		// Searching for it finds nothing.
		await open(viewer, `${base}/sources?q=Livia`);
		await expect(viewer.getByTestId('no-sources')).toBeVisible();

		// The dead person's page shows their citation, and the viewer can read but not edit it.
		await open(viewer, `${base}/people/${encodeURIComponent(old.id)}`);
		// The citation sits against the fact it supports, so that fact's disclosure names it.
		const cited = viewer.getByTestId('citations-disclosure').filter({ hasText: 'Census 1851' });
		await expect(cited).toHaveCount(1);
		await cited.locator('summary').click();
		await expect(cited.getByTestId('citation')).toContainText('Census 1851');
		await expect(viewer.getByRole('button', { name: /Add a citation/ })).toHaveCount(0);

		// The owner sees both.
		await open(page, `${base}/sources`);
		await expect(
			page.getByRole('link', { name: 'Birth certificate of Livia Aliveson' })
		).toBeVisible();
	} finally {
		await viewerContext.close();
	}
});
