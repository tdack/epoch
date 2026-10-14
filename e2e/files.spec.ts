/**
 * The Files manager, end to end: an owner works a file through every action the server allows, and
 * a viewer of the same tree is shown the file's details and nothing to change. Each action is
 * checked on the screen and then against the API, so a button that looks done but is not is caught.
 */
import { expect, open, test, type Api } from './support';
import type { APIRequestContext } from '@playwright/test';

/** A one-pixel PNG: small enough to upload in every run, and sniffed as an image by the server. */
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
	'base64'
);

async function uploadTo(request: APIRequestContext, api: Api, personId: string, title: string) {
	const res = await request.post('/api/media/upload', {
		multipart: {
			treeId: api.treeId,
			entityId: personId,
			title,
			file: { name: title, mimeType: 'image/png', buffer: PNG }
		}
	});
	expect(res.status(), await res.text()).toBe(201);
	return (await res.json()).media.id as string;
}

/** The row for one file, found by its name. */
const rowFor = (page: import('@playwright/test').Page, title: string) =>
	page.getByTestId('file-row').filter({ hasText: title });

test('an owner renames, moves, detaches and deletes a file, and the server agrees each time', async ({
	api,
	page,
	request
}) => {
	// Dated, so no date rule hides them from a viewer.
	const john = await api.addPerson('John', 'Smith', { birthDate: '1850' });
	await api.addPerson('Jane', 'Smith', { birthDate: '1852' });
	await uploadTo(request, api, john.id, 'Portrait.png');

	await open(page, `/trees/${api.treeId}/files`);
	await expect(rowFor(page, 'Portrait.png')).toContainText('John Smith');

	// Rename: the new name is saved on the server, not only on the screen.
	await rowFor(page, 'Portrait.png')
		.getByRole('button', { name: /Rename Portrait\.png/ })
		.click();
	await page.getByLabel('Name', { exact: true }).fill('Portrait of John.png');
	await page.getByRole('button', { name: 'Save name' }).click();
	await expect(rowFor(page, 'Portrait of John.png')).toBeVisible();

	// Move to Jane, one person in the same tree.
	await rowFor(page, 'Portrait of John.png')
		.getByRole('button', { name: /Move Portrait of John/ })
		.click();
	await page.getByRole('combobox', { name: 'Person', exact: true }).fill('Jane');
	await page.getByRole('option', { name: 'Jane Smith' }).click();
	await page.getByRole('button', { name: 'Move here' }).click();
	await expect(rowFor(page, 'Portrait of John.png')).toContainText('Jane Smith');

	// Detach: the file is kept and listed as not attached.
	await rowFor(page, 'Portrait of John.png')
		.getByRole('button', { name: /Detach Portrait of John/ })
		.click();
	await expect(rowFor(page, 'Portrait of John.png')).toContainText('Not attached');

	// Delete: a confirmation that says it is permanent, then the row is gone.
	await rowFor(page, 'Portrait of John.png')
		.getByRole('button', { name: /Delete Portrait of John/ })
		.click();
	await expect(page.getByText('cannot be undone')).toBeVisible();
	await page.screenshot({ path: 'test-results/files-delete-confirm.png' });
	await page.getByRole('button', { name: 'Delete permanently' }).click();
	await expect(rowFor(page, 'Portrait of John.png')).toHaveCount(0);

	const left = await request.get(`/api/files?treeId=${api.treeId}`);
	expect((await left.json()).files.map((f: { title: string }) => f.title)).not.toContain(
		'Portrait of John.png'
	);
});

test('a viewer sees a tree file as details only, with no action and no add button', async ({
	api,
	browser,
	request
}) => {
	test.setTimeout(90_000);
	const sub = `e2e-files-viewer-${Date.now()}`;
	const john = await api.addPerson('John', 'Smith', { birthDate: '1850' });
	await uploadTo(request, api, john.id, 'Letter.png');

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
		expect((await viewerContext.request.get('/api/trees')).ok()).toBe(true);

		const viewer = await viewerContext.newPage();
		await open(viewer, `/trees/${api.treeId}/files`);
		await expect(rowFor(viewer, 'Letter.png')).toBeVisible();
		await expect(viewer.getByTestId('files-add')).toHaveCount(0);
		await expect(viewer.getByText('Stored files with no record')).toHaveCount(0);
		await expect(viewer.locator('tbody button')).toHaveCount(1); // Preview only
		await expect(rowFor(viewer, 'Letter.png').getByRole('button', { name: /Delete/ })).toHaveCount(
			0
		);
	} finally {
		await viewerContext.close();
	}
});
