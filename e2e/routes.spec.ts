import { readFileSync } from 'node:fs';
import { type APIRequestContext } from '@playwright/test';
import { card, expect, open, test, type Api } from './support';

const WINDSORS_GED = readFileSync('test/data/The Windsors.ged');

/** The GEDCOM `GIVN` and `SURN` win over the free-text `NAME` line, so this is what the page shows. */
const ELIZABETH_NAME = 'Elizabeth, Alexandra, Mary Windsor';

/** Imported ids are `<treeId>:@I_…@`, which is what makes a link need encoding. */
const XREF = { elizabeth: '@X1030@' } as const;

async function importWindsors(request: APIRequestContext, api: Api) {
	const res = await request.post('/api/import', {
		multipart: {
			file: { name: 'The Windsors.ged', mimeType: 'text/plain', buffer: WINDSORS_GED },
			treeId: api.treeId,
			mode: 'replace'
		}
	});
	expect(res.ok(), await res.text()).toBe(true);
}

const personPath = (api: Api, xref: string) =>
	`/trees/${api.treeId}/people/${encodeURIComponent(`${api.treeId}:${xref}`)}`;

test('the old address redirects to the tree, keeping the view', async ({ page, request, api }) => {
	await importWindsors(request, api);
	const focus = encodeURIComponent(`${api.treeId}:${XREF.elizabeth}`);
	await page.goto(`/?tree=${api.treeId}&focus=${focus}&up=2&siblings=0`);
	await expect(card(page, 'Elizabeth')).toBeVisible();
	const url = new URL(page.url());
	expect(url.pathname).toBe(`/trees/${api.treeSlug}`);
	expect(url.searchParams.get('focus')).toBe(`${api.treeId}:${XREF.elizabeth}`);
	expect(url.searchParams.get('up')).toBe('2');
	expect(url.searchParams.get('siblings')).toBe('0');
	expect(url.searchParams.has('tree')).toBe(false);
});

test('a tree opens without ever asking for the whole tree', async ({ page, request, api }) => {
	await importWindsors(request, api);
	const requested: string[] = [];
	page.on('request', (r) => {
		if (r.url().includes('/api/'))
			requested.push(new URL(r.url()).pathname + new URL(r.url()).search);
	});
	await page.goto(`/trees/${api.treeId}`);
	await expect(card(page, 'Elizabeth')).toBeVisible();
	// The default focus is resolved by the server and written into the address.
	await expect.poll(() => new URL(page.url()).searchParams.get('focus')).toBeTruthy();

	const graphCalls = requested.filter((r) => r.includes('/graph'));
	expect(graphCalls.length).toBeGreaterThan(0);
	for (const call of graphCalls)
		expect(call, 'every graph request names a focus').toContain('focus=');
	// No whole-tree endpoint: not the tree details, not an unfocused graph.
	expect(requested.filter((r) => r === `/api/trees/${api.treeId}`)).toEqual([]);
});

test('a person page deep-links, survives a refresh and follows browser history', async ({
	page,
	request,
	api
}) => {
	await importWindsors(request, api);
	await open(page, personPath(api, XREF.elizabeth));
	await expect(page.getByTestId('person-name')).toHaveText(ELIZABETH_NAME);
	await expect(page.getByTestId('lifespan')).toContainText('21 April 1926');

	await page.reload();
	await page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
	await expect(page.getByTestId('person-name')).toHaveText(ELIZABETH_NAME);

	// Follow a relative, then Back and Forward.
	await page
		.getByTestId('parents')
		.getByRole('link', { name: /George/ })
		.click();
	await expect(page.getByTestId('person-name')).toContainText('George');
	const georgeUrl = page.url();
	await page.goBack();
	await expect(page.getByTestId('person-name')).toHaveText(ELIZABETH_NAME);
	await page.goForward();
	await expect(page.getByTestId('person-name')).toContainText('George');
	expect(page.url()).toBe(georgeUrl);
});

test('the person page shows partnerships, children, siblings and links to the partnership', async ({
	page,
	request,
	api
}) => {
	await importWindsors(request, api);
	await open(page, personPath(api, XREF.elizabeth));
	await expect(page.getByTestId('partnership')).toHaveCount(1);
	await expect(page.getByTestId('partnership')).toContainText('Philip');
	await expect(page.getByTestId('siblings')).toContainText('Margaret');
	await expect(page.getByTestId('history')).toHaveCount(0);
	await expect(page.getByText('Imported records have no history.')).toBeVisible();
});

test('a partnership page shows partners, events, children and chronology, and deep-links', async ({
	page,
	request,
	api
}) => {
	await importWindsors(request, api);
	await open(page, personPath(api, XREF.elizabeth));
	await page
		.getByTestId('parents')
		.getByRole('link', { name: /partnership/i })
		.click();
	await expect(page).toHaveURL(new RegExp(`/trees/${api.treeSlug}/unions/`));
	await expect(page.getByTestId('partners')).toContainText('George');
	await expect(page.getByTestId('partners')).toContainText('Elizabeth');
	await expect(page.getByTestId('union-children')).toContainText('Elizabeth');
	await expect(page.getByTestId('union-children')).toContainText('Margaret');
	await expect(page.getByTestId('chronology').locator('li').first()).toBeVisible();
	await expect(page.getByTestId('union-events')).toContainText('Marriage');
	await expect(page.getByTestId('union-events')).toContainText('26 April 1923');

	const url = page.url();
	await page.reload();
	await page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
	await expect(page.getByTestId('union-title')).toContainText('George');
	expect(page.url()).toBe(url);
	await page.goBack();
	await expect(page.getByTestId('person-name')).toHaveText(ELIZABETH_NAME);
});

test('a partnership with no events invites you to add one', async ({ page, api }) => {
	const [ann, ben] = [await api.addPerson('Ann', 'Reed'), await api.addPerson('Ben', 'Reed')];
	await api.partner(ann, ben);
	const union = (await api.graph()).unions[0]!;
	await open(page, `/trees/${api.treeId}/unions/${encodeURIComponent(union.id)}`);
	await expect(page.getByText('None recorded. Use Edit to add a marriage')).toBeVisible();
});

test('a person who does not exist shows a not-found page, not a blank screen', async ({
	page,
	api
}) => {
	const response = await page.goto(`/trees/${api.treeId}/people/nobody`);
	expect(response?.status()).toBe(404);
});

test('a partnership page lists its events and warns only where the dates rule something out', async ({
	page,
	api
}) => {
	const [ann, ben] = [
		await api.addPerson('Ann', 'Reed', { birthDate: '1901' }),
		await api.addPerson('Ben', 'Reed', { birthDate: '1899' })
	];
	await api.partner(ann, ben);
	const union = (await api.graph()).unions[0]!;
	const put = await page.request.put(`/api/trees/${api.treeId}/unions/${union.id}`, {
		data: {
			version: union.version,
			events: [{ id: null, type: 'MARR', dateText: '1890', place: 'Leeds' }]
		}
	});
	expect(put.ok(), await put.text()).toBe(true);

	await open(page, `/trees/${api.treeId}/unions/${encodeURIComponent(union.id)}`);
	await expect(page.getByTestId('union-events')).toContainText('Marriage');
	await expect(page.getByTestId('union-events')).toContainText('1890 · Leeds');
	const warnings = page.getByTestId('warnings').locator('[data-warning="event_before_birth"]');
	await expect(warnings).toHaveCount(2);
	await expect(warnings.first()).toContainText('is dated before');
	await expect(page.getByTestId('chronology').locator('li').first()).toContainText('1890');
});

test('a tree that does not exist answers with an error page, not a crash', async ({ page }) => {
	const response = await page.goto(`/trees/${crypto.randomUUID()}`);
	expect(response?.status()).toBeLessThan(500);
});
