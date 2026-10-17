import { describe, expect, it } from 'vitest';
import {
	appOrigin,
	classifyHost,
	subdomainRefusal,
	treeHostConfig,
	treeHostRoute
} from './tree-host';

const config = treeHostConfig({
	EPOCH_TREE_HOST_ZONE: 'epochgenealogy.app',
	EPOCH_RESERVED_SUBDOMAINS: 'demo, cf-bounce'
})!;
const dacks = { id: 'b8ea1a57-0000-4000-8000-000000000001', slug: 'dacks' };
const route = (pathname: string, search = '') => treeHostRoute({ pathname, search }, dacks);

describe('treeHostConfig', () => {
	it('is off without a zone', () => {
		expect(treeHostConfig({})).toBeNull();
		expect(treeHostConfig({ EPOCH_TREE_HOST_ZONE: '  ' })).toBeNull();
		expect(treeHostConfig(undefined)).toBeNull();
	});

	it('serves the app on the zone itself unless told otherwise', () => {
		expect(config.appHost).toBe('epochgenealogy.app');
	});

	it('reserves the built-in labels, the listed ones, and an app host beside the trees', () => {
		expect([...config.reserved]).toEqual(expect.arrayContaining(['www', 'demo', 'cf-bounce']));
		const beside = treeHostConfig({
			EPOCH_TREE_HOST_ZONE: 'example.com',
			EPOCH_APP_HOST: 'epoch.example.com'
		})!;
		expect(beside.reserved.has('epoch')).toBe(true);
		expect(classifyHost('epoch.example.com', beside)).toEqual({ kind: 'app' });
	});
});

describe('classifyHost', () => {
	it.each([
		['epochgenealogy.app', { kind: 'app' }],
		['EpochGenealogy.app', { kind: 'app' }],
		// A host outside the zone keeps working as it did: a workers.dev address kept during a move.
		['epoch-genealogy.dack.workers.dev', { kind: 'app' }],
		['localhost', { kind: 'app' }],
		['dacks.epochgenealogy.app', { kind: 'tree', label: 'dacks' }],
		// Reserved: reaching the Worker through the wildcard must not serve a second copy of the app.
		['www.epochgenealogy.app', { kind: 'unknown' }],
		['demo.epochgenealogy.app', { kind: 'unknown' }],
		['login.epochgenealogy.app', { kind: 'unknown' }],
		['a.b.epochgenealogy.app', { kind: 'unknown' }],
		['not--a-slug.epochgenealogy.app', { kind: 'unknown' }],
		['notepochgenealogy.app', { kind: 'app' }]
	])('%s', (hostname, expected) => {
		expect(classifyHost(hostname, config)).toEqual(expected);
	});

	it('treats every host as the app when the feature is off', () => {
		expect(classifyHost('dacks.epochgenealogy.app', null)).toEqual({ kind: 'app' });
	});

	it('works for local trial on *.localhost', () => {
		const local = treeHostConfig({ EPOCH_TREE_HOST_ZONE: 'localhost' });
		expect(classifyHost('dacks.localhost', local)).toEqual({ kind: 'tree', label: 'dacks' });
		expect(classifyHost('localhost', local)).toEqual({ kind: 'app' });
	});
});

describe('appOrigin', () => {
	it('keeps the scheme and port', () => {
		const local = treeHostConfig({ EPOCH_TREE_HOST_ZONE: 'localhost' })!;
		expect(appOrigin(new URL('http://dacks.localhost:5173/trees/dacks'), local)).toBe(
			'http://localhost:5173'
		);
		expect(appOrigin(new URL('https://dacks.epochgenealogy.app/'), config)).toBe(
			'https://epochgenealogy.app'
		);
	});
});

describe('treeHostRoute', () => {
	it('opens the tree at the root, keeping the query', () => {
		expect(route('/', '?focus=p1')).toEqual({
			action: 'redirect',
			location: '/trees/dacks?focus=p1'
		});
	});

	it("serves the tree's own pages by slug or id", () => {
		expect(route('/trees/dacks')).toEqual({ action: 'serve' });
		expect(route('/trees/dacks/people/p1')).toEqual({ action: 'serve' });
		expect(route(`/trees/${dacks.id}/people`)).toEqual({ action: 'serve' });
	});

	it('refuses another tree, in pages and in the API', () => {
		expect(route('/trees/windsors')).toEqual({ action: 'not-found' });
		expect(route('/api/trees/windsors/summary')).toEqual({ action: 'not-found' });
	});

	it("serves this tree's API, and API paths not about one tree", () => {
		expect(route(`/api/trees/${dacks.id}/summary`)).toEqual({ action: 'serve' });
		expect(route('/api/trees')).toEqual({ action: 'serve' });
		expect(route('/api/settings')).toEqual({ action: 'serve' });
	});

	it('serves sign-in on the tree host', () => {
		expect(route('/welcome')).toEqual({ action: 'serve' });
		expect(route('/login')).toEqual({ action: 'serve' });
	});

	it('sends the pages that span trees to the app host', () => {
		expect(route('/trees/dacks/trees')).toEqual({ action: 'app', path: '/trees/dacks/trees' });
		expect(route('/trees/dacks/files', '?q=x')).toEqual({
			action: 'app',
			path: '/trees/dacks/files?q=x'
		});
		expect(route('/settings')).toEqual({ action: 'app', path: '/settings' });
		expect(route('/manage/trees')).toEqual({ action: 'app', path: '/manage/trees' });
	});

	it('does not mistake a longer name for an install-wide page', () => {
		expect(route('/settingsx')).toEqual({ action: 'serve' });
		expect(route('/trees/dacks/treesx')).toEqual({ action: 'serve' });
	});
});

describe('subdomainRefusal', () => {
	it('needs a slug, and refuses a reserved one', () => {
		expect(subdomainRefusal(null, config)).toMatch(/address first/);
		expect(subdomainRefusal('demo', config)).toMatch(/reserved/);
		expect(subdomainRefusal('dacks', config)).toBeNull();
	});
});
