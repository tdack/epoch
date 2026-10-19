import { describe, expect, it } from 'vitest';
import type { DnsRecord, ZoneRoute } from './cloudflare.ts';
import { subdomainFindings } from './doctor.ts';
import { OWNERSHIPS, type SubdomainSettings } from './manifest.ts';

const INSTALL_ID = '11111111-1111-4111-8111-111111111111';

const SETTINGS: SubdomainSettings = {
	zone: { id: 'z', name: 'example.com' },
	reservedLabels: ['www'],
	appHost: 'epoch.example.com',
	dnsRecordId: 'rec-star',
	exclusionRoutes: [{ id: 'route-www', pattern: 'www.example.com/*', ownership: OWNERSHIPS.owned }],
	isActive: true
};

const RECORD: DnsRecord = {
	id: 'rec-star',
	name: '*.example.com',
	type: 'AAAA',
	content: '100::',
	isProxied: true,
	comment: `epoch:${INSTALL_ID}`
};

const WILDCARD_ROUTE: ZoneRoute = { id: 'route-star', pattern: '*.example.com/*', script: 'epoch' };
const WWW_ROUTE: ZoneRoute = { id: 'route-www', pattern: 'www.example.com/*', script: null };
const ROUTES = [WILDCARD_ROUTE, WWW_ROUTE];

function findings(overrides: {
	settings?: SubdomainSettings;
	records?: DnsRecord[];
	routes?: ZoneRoute[];
	accessDestinations?: string[] | null;
}) {
	return subdomainFindings({
		installId: INSTALL_ID,
		workerName: 'epoch',
		settings: overrides.settings ?? SETTINGS,
		records: overrides.records ?? [RECORD],
		routes: overrides.routes ?? ROUTES,
		accessDestinations:
			overrides.accessDestinations === undefined
				? ['epoch.example.com/login', '*.example.com/login']
				: overrides.accessDestinations
	}).map((f) => `${f.level}: ${f.text}`);
}

describe('subdomainFindings', () => {
	it('passes an install whose record, routes and Access destination are all in place', () => {
		expect(findings({})).toEqual([
			'ok: DNS record *.example.com is proxied',
			'ok: Worker route *.example.com/* sends trees to epoch',
			'ok: 1 exclusion route(s) in place',
			'ok: Access application protects *.example.com/login'
		]);
	});

	it('only warns while the subdomains are off or `./setup subdomains` has not finished', () => {
		expect(
			findings({ settings: { ...SETTINGS, isActive: false }, records: [], routes: [] })
		).toEqual([
			'warn: Tree subdomains on example.com are off, or a run stopped part-way; `./setup subdomains` turns them on'
		]);
	});

	it('finds the record by its marker when the settings were seeded without its id', () => {
		expect(findings({ settings: { ...SETTINGS, dnsRecordId: null } })).toContain(
			'ok: DNS record *.example.com is proxied'
		);
	});

	it('fails a deleted or unproxied record and warns on a lost marker', () => {
		expect(findings({ records: [] })).toContain(
			'fail: DNS record *.example.com is gone, so no tree subdomain resolves'
		);
		const drifted = findings({ records: [{ ...RECORD, isProxied: false, comment: null }] });
		expect(drifted).toContain('fail: DNS record *.example.com is proxied');
		expect(drifted).toContain(
			`warn: DNS record *.example.com has lost its epoch:${INSTALL_ID} comment`
		);
	});

	it('fails a missing wildcard route, or one that names another Worker', () => {
		expect(findings({ routes: [WWW_ROUTE] })).toContain(
			'fail: Worker route *.example.com/* is missing; `npm run deploy` adds it'
		);
		expect(findings({ routes: [{ ...WILDCARD_ROUTE, script: 'other' }, WWW_ROUTE] })).toContain(
			'fail: Worker route *.example.com/* sends trees to epoch (it names other)'
		);
	});

	it('fails an exclusion route that is gone or now names a Worker', () => {
		const gone = findings({ routes: [WILDCARD_ROUTE] });
		expect(gone).toContain(
			'fail: Exclusion route www.example.com/* is gone, so the wildcard takes www.example.com'
		);
		expect(gone.some((line) => line.includes('exclusion route(s) in place'))).toBe(false);
		expect(findings({ routes: [WILDCARD_ROUTE, { ...WWW_ROUTE, script: 'other' }] })).toContain(
			'fail: Exclusion route www.example.com/* now sends www.example.com to other'
		);
	});

	it('fails a missing Access destination and says nothing of one when the app is gone', () => {
		expect(findings({ accessDestinations: ['epoch.example.com/login'] })).toContain(
			'fail: Access application protects *.example.com/login'
		);
		expect(findings({ accessDestinations: null }).some((l) => l.includes('Access'))).toBe(false);
	});
});
