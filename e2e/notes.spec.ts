import { expect, open, test } from './support';

/**
 * Notes as records (ADR-029): a note is added to a fact from the drawer and from the page, one is
 * shared between two people and found on its page, and a viewer never sees a private person's notes
 * or a shared note only they use.
 */

test('a note is added to a fact from the drawer and from the person page', async ({
	page,
	api
}) => {
	test.setTimeout(90_000);
	const wren = await api.addPerson('Wren', 'Ash', { birthDate: '4 MAR 1900', birthPlace: 'Leeds' });
	const base = `/trees/${api.treeId}`;

	// From the person page: open the birth's notes and add one.
	await open(page, `${base}/people/${encodeURIComponent(wren.id)}`);
	const birth = page.getByTestId('fact').first();
	await birth.getByText('Add a note').click();
	await birth.getByRole('button', { name: 'Add a note to the birth' }).click();
	const dialog = page.getByRole('dialog', { name: 'Add a note' });
	await dialog.getByTestId('note-text').fill('Born at home, in the back bedroom.');
	await dialog.getByRole('button', { name: 'Add note', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(birth.getByText('1 note')).toBeVisible();
	await expect(birth.getByTestId('note')).toContainText('Born at home, in the back bedroom.');

	// From the drawer on the tree: the same fact, a second note, kept in order.
	await page.goto(
		`${base}?focus=${encodeURIComponent(wren.id)}&person=${encodeURIComponent(wren.id)}`
	);
	const drawer = page.getByRole('complementary').or(page.locator('[data-testid="person-drawer"]'));
	await expect(drawer.getByRole('heading', { name: 'Wren Ash' }).first()).toBeVisible();
	const drawerBirth = drawer.getByTestId('fact').first();
	await drawerBirth.getByText('1 note').click();
	await drawerBirth.getByRole('button', { name: 'Add a note to the birth' }).click();
	const again = page.getByRole('dialog', { name: 'Add a note' });
	await again.getByTestId('note-text').fill('Registered a week later.');
	await again.getByRole('button', { name: 'Add note', exact: true }).click();
	await expect(again).toBeHidden();
	await expect(drawerBirth.getByText('2 notes')).toBeVisible();
	await expect(drawerBirth.getByTestId('note').first()).toContainText('Born at home');
	await expect(drawerBirth.getByTestId('note').nth(1)).toContainText('Registered a week later.');

	// An edit is an edit, and Undo puts the words back.
	await drawerBirth.getByRole('button', { name: 'Edit the note on the birth' }).first().click();
	const edit = page.getByRole('dialog', { name: 'Edit note' });
	await edit.getByTestId('note-text').fill('Born at home.');
	await edit.getByRole('button', { name: 'Save note' }).click();
	await expect(edit).toBeHidden();
	await expect(drawerBirth.getByTestId('note').first()).toHaveText(/^\s*Born at home\.\s/);
	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(drawerBirth.getByTestId('note').first()).toContainText('in the back bedroom');
});

test('a note is shared between two people and both are on its page', async ({ page, api }) => {
	test.setTimeout(90_000);
	const wren = await api.addPerson('Wren', 'Ash', { birthDate: '1900' });
	const bram = await api.addPerson('Bram', 'Ash', { birthDate: '1902' });
	const base = `/trees/${api.treeId}`;

	await open(page, `${base}/people/${encodeURIComponent(wren.id)}`);
	const notes = page.locator('[data-section="notes"]');
	await notes.getByRole('button', { name: 'Add a note to Wren Ash' }).click();
	const dialog = page.getByRole('dialog', { name: 'Add a note' });
	await dialog.getByTestId('note-text').fill('The Ash family came from Cork.');
	await dialog.getByRole('button', { name: 'Add note', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(notes.getByTestId('note')).toContainText('The Ash family came from Cork.');

	// Share it: the person's note now says so, and it is a record of its own.
	await notes.getByRole('button', { name: 'Share the note on Wren Ash' }).click();
	await expect(notes.getByTestId('note-shared')).toContainText('Shared note, used by 1 record');

	// Bram uses the same note.
	await open(page, `${base}/people/${encodeURIComponent(bram.id)}`);
	const bramNotes = page.locator('[data-section="notes"]');
	await bramNotes.getByRole('button', { name: 'Add a note to Bram Ash' }).click();
	const choose = page.getByRole('dialog', { name: 'Add a note' });
	await choose.getByRole('tab', { name: 'Use a shared note' }).click();
	await choose.getByLabel('Search shared notes by their words').fill('Cork');
	await choose
		.getByTestId('note-results')
		.getByRole('button', { name: /The Ash family came from Cork/ })
		.click();
	await expect(choose).toBeHidden();
	await expect(bramNotes.getByTestId('note-shared')).toContainText(
		'Shared note, used by 2 records'
	);

	// Its page lists both people, each linking to their own page.
	await bramNotes.getByRole('link', { name: /Shared note, used by 2 records/ }).click();
	await expect(page.getByTestId('note-text')).toHaveText('The Ash family came from Cork.');
	await expect(page.getByTestId('note-use-count')).toContainText('Used by 2 records');
	const uses = page.getByTestId('note-use');
	await expect(uses).toHaveCount(2);
	await expect(uses.filter({ hasText: 'Wren Ash' })).toHaveCount(1);
	await expect(uses.filter({ hasText: 'Bram Ash' })).toHaveCount(1);
	await uses.filter({ hasText: 'Wren Ash' }).getByRole('link').click();
	await expect(page.getByRole('heading', { name: 'Wren Ash' }).first()).toBeVisible();

	// It is on the list, which can be searched.
	await open(page, `${base}/notes?q=Cork`);
	await expect(page.getByTestId('notes-list')).toContainText('The Ash family came from Cork.');
	await expect(page.getByTestId('notes-list')).toContainText('2 records');
});

test('a viewer never sees a private person’s notes, or a shared note only they use', async ({
	api,
	page,
	browser,
	request
}) => {
	test.setTimeout(120_000);
	const sub = `e2e-notes-viewer-${Date.now()}`;
	const old = await api.addPerson('Olda', 'Oldman', { birthDate: '1850', birthPlace: 'Cork' });
	const living = await api.addPerson('Livia', 'Aliveson', { birthDate: '1990' });
	const addNote = async (id: string, text: string) =>
		(
			await (
				await request.post(`/api/trees/${api.treeId}/note-links`, {
					data: { subject: { kind: 'person', id }, text }
				})
			).json()
		).attachmentId as string;
	await addNote(old.id, 'Olda was a weaver.');
	await addNote(living.id, 'Livia’s diary is in the loft.');
	const shared = (
		await (
			await request.post(`/api/trees/${api.treeId}/notes`, {
				data: { text: 'Letters between Livia and her mother' }
			})
		).json()
	).noteId as string;
	const attach = await request.post(`/api/trees/${api.treeId}/note-links`, {
		data: { subject: { kind: 'person', id: living.id }, noteId: shared }
	});
	expect(attach.status(), await attach.text()).toBe(201);

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
		await open(viewer, `${base}/notes`);
		await expect(viewer.getByTestId('no-notes')).toBeVisible();
		await expect(viewer.getByText('Livia')).toHaveCount(0);

		// The shared note only a private person uses answers like one that is not there.
		const hidden = await viewer.request.get(`${base}/notes/${encodeURIComponent(shared)}`);
		const missing = await viewer.request.get(`${base}/notes/no-such-note`);
		expect(hidden.status()).toBe(404);
		expect(missing.status()).toBe(404);
		await open(viewer, `${base}/notes?q=Livia`);
		await expect(viewer.getByTestId('no-notes')).toBeVisible();

		// The dead person's page shows their note, read-only for a viewer.
		await open(viewer, `${base}/people/${encodeURIComponent(old.id)}`);
		await expect(viewer.locator('[data-section="notes"]')).toContainText('Olda was a weaver.');
		await expect(viewer.getByRole('button', { name: /Add a note/ })).toHaveCount(0);

		// The owner sees the private person's notes and the shared one.
		await open(page, `${base}/people/${encodeURIComponent(living.id)}`);
		await expect(page.locator('[data-section="notes"]')).toContainText(
			'Livia’s diary is in the loft.'
		);
		await open(page, `${base}/notes`);
		await expect(page.getByTestId('notes-list')).toContainText('Letters between Livia');
	} finally {
		await viewerContext.close();
	}
});
