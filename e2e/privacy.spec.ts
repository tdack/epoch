import { execFileSync } from 'node:child_process';
import { expect, open, test } from './support';

/**
 * A contributor or viewer never sees a living person; a manager does, and decides. The viewer is a
 * second identity (the dev bypass reads `x-dev-user-sub`) invited by the owner and taken up on first sign-in.
 */

const SHOTS = process.env.E2E_SHOTS ?? 'test-results';

function sql(statement: string) {
	execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--command', statement], {
		stdio: 'ignore'
	});
}

test('a viewer is shown the dead and never the living, and a manager can change that', async ({
	api,
	page,
	browser,
	request
}) => {
	// Many pages and a second identity: well past the default 30 seconds.
	test.setTimeout(120_000);
	const sub = `e2e-viewer-${Date.now()}`;
	const old = await api.addPerson('Olda', 'Oldman', { birthDate: '1850', birthPlace: 'Cork' });
	const living = await api.addPerson('Livia', 'Aliveson', {
		birthDate: '1990',
		birthPlace: 'Perthville'
	});
	const kin = await api.addPerson('Kitt', 'Oldman', { birthDate: '1880', deathDate: '1950' });
	await api.child(old, kin);
	await api.child(kin, living);

	// Headers for the API, and the same identity as cookies so the server render of a page is that user too.
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
		// The owner invites the address; the viewer's first request creates the identity and takes it up.
		const invited = await request.post(`/api/trees/${api.treeId}/invitations`, {
			data: { email: identity['x-dev-user-email'], role: 'viewer' }
		});
		expect(invited.status()).toBe(201);
		expect((await viewerContext.request.get('/api/trees')).ok()).toBe(true);

		const viewer = await viewerContext.newPage();
		const base = `/trees/${api.treeId}`;

		// The people list and the surname list leave the living person out, with their surname.
		await open(viewer, `${base}/people`);
		await expect(viewer.getByRole('link', { name: 'Olda Oldman' })).toBeVisible();
		await expect(viewer.getByText('Livia')).toHaveCount(0);
		await expect(viewer.getByText('Aliveson')).toHaveCount(0);
		await viewer.screenshot({ path: `${SHOTS}/privacy-viewer-people.png` });
		await open(viewer, `${base}/surnames`);
		await expect(viewer.getByText('Oldman')).toBeVisible();
		await expect(viewer.getByText('Aliveson')).toHaveCount(0);

		// Search by name, by the place of their birth and by their id finds nothing.
		for (const query of [
			'q=Livia',
			'place=Perthville',
			`q=${encodeURIComponent(living.id.split(':')[1] ?? '')}`
		]) {
			await open(viewer, `${base}/search?${query}`);
			await expect(viewer.getByTestId('search-result')).toHaveCount(0);
		}

		// Their page answers like a page that is not there.
		const direct = await viewer.request.get(
			`/api/trees/${api.treeId}/people/${encodeURIComponent(living.id)}`
		);
		const missing = await viewer.request.get(`/api/trees/${api.treeId}/people/no-such-person`);
		expect(direct.status()).toBe(404);
		expect(missing.status()).toBe(404);

		// In the tree they are left out; with placeholders on they are a muted "Private" card that does nothing.
		await open(viewer, `${base}?focus=${encodeURIComponent(kin.id)}`);
		await expect(
			viewer.locator('[data-person-id]').filter({ hasText: 'Kitt' }).first()
		).toBeVisible();
		await expect(viewer.locator('[data-person-id]').filter({ hasText: 'Livia' })).toHaveCount(0);
		await viewer.screenshot({ path: `${SHOTS}/privacy-viewer-tree-omitted.png` });

		// Export is not offered to a viewer, and the endpoint refuses.
		await viewer.locator('header button[aria-haspopup="menu"]').click();
		await expect(viewer.getByRole('menuitem', { name: /Export/ })).toHaveCount(0);
		await viewer.keyboard.press('Escape');
		expect((await viewer.request.get(`/api/export?treeId=${api.treeId}`)).status()).toBe(403);
		await viewer
			.getByRole('navigation', { name: 'Tree sections' })
			.getByRole('button', { name: 'More' })
			.click();
		await expect(viewer.getByRole('menuitem', { name: 'Privacy' })).toHaveCount(0);
		await expect(viewer.getByRole('menuitem', { name: 'Members' })).toHaveCount(0);
		await viewer.keyboard.press('Escape');
		expect((await viewer.request.get(`/api/trees/${api.treeId}/members`)).status()).toBe(403);

		// The owner turns placeholders on.
		await open(page, `${base}/privacy`);
		await page.getByLabel(/Show hidden people as/).check();
		await page.getByRole('button', { name: 'Save' }).click();
		await expect(page.getByText('Privacy settings saved')).toBeVisible();
		await page.screenshot({ path: `${SHOTS}/privacy-settings.png` });

		await open(viewer, `${base}?focus=${encodeURIComponent(kin.id)}`);
		const placeholder = viewer.locator('[data-person-id]').filter({ hasText: 'Private' }).first();
		await expect(placeholder).toBeVisible();
		await expect(placeholder).toHaveAttribute('aria-disabled', 'true');
		await expect(viewer.locator('[data-person-id]').filter({ hasText: 'Aliveson' })).toHaveCount(0);
		await viewer.screenshot({ path: `${SHOTS}/privacy-viewer-tree-placeholder.png` });

		// The owner sees the living person, says why they are hidden, and can show them.
		await open(page, `${base}/people/${encodeURIComponent(living.id)}`);
		await expect(page.getByTestId('privacy-effect')).toContainText(
			'Hidden from contributors and viewers'
		);
		await page.screenshot({ path: `${SHOTS}/privacy-manager-person.png` });
		await page.getByLabel('Who may see this person').selectOption('public');
		await expect(page.getByTestId('privacy-effect')).toContainText(
			'Contributors and viewers can see them'
		);
		await open(viewer, `${base}/people`);
		await expect(viewer.getByRole('link', { name: 'Livia Aliveson' })).toBeVisible();
	} finally {
		await viewerContext.close();
		sql(`delete from users where access_sub = '${sub}'`);
	}
});
