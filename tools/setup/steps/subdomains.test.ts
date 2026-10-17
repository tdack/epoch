import { describe, expect, it } from 'vitest';
import type { Asker } from '../asker.ts';
import type { CloudflareApi, DnsRecord, WorkerDomain, ZoneRoute } from '../cloudflare.ts';
import { NO_DEFAULTS } from '../deploy-config.ts';
import { ERROR_CODES, SetupError } from '../errors.ts';
import { OWNERSHIPS, type Manifest, type SubdomainSettings } from '../manifest.ts';
import { BASE_SCOPES, requiredScopes, SUBDOMAIN_SCOPES } from '../scopes.ts';
import {
	NO_ASKER,
	TEST_ROOT,
	baseFiles,
	fakeExec,
	fixture,
	memoryFs,
	stubApi,
	testContext,
	testManifest
} from '../testing.ts';
import { deployValuesOf } from './write-config.ts';
import {
	dnsMarker,
	planSubdomainTeardown,
	planSubdomains,
	removeSubdomainItem,
	runSubdomains,
	seedSubdomains,
	surveyZone
} from './subdomains.ts';

const ZONE = { id: 'zone00000000000000000000000000001', name: 'example.com' };
const records = (fixture('dns-records-list.json') as Record<string, unknown>[]).map(
	(r): DnsRecord => ({
		id: r.id as string,
		name: r.name as string,
		type: r.type as string,
		content: r.content as string,
		isProxied: r.proxied === true,
		comment: (r.comment as string | null) ?? null
	})
);
const routes = (fixture('workers-routes-list.json') as { result: ZoneRoute[] }).result;
const domains = (fixture('workers-domains-list.json') as { result: WorkerDomain[] }).result;

const install = testManifest({
	account: { id: 'acc', name: 'A' },
	zone: ZONE,
	hosting: 'custom',
	hostname: 'example.com',
	teamDomain: 'team.cloudflareaccess.com',
	access: {
		app: { id: 'app00000-0000-4000-8000-000000000002', name: 'Epoch (epoch)', aud: 'aud-epoch' },
		policies: [{ id: 'pol1', name: 'Family', ownership: OWNERSHIPS.referenced }],
		idps: ['idp1']
	}
});
const MARKER = dnsMarker(install.installId);
const YES = { isYes: true, isInteractive: false };
const presenter = { showPlan: () => {}, showHandOff: () => {} };

describe('what the wildcard route would capture', () => {
	const base = { zone: 'example.com', records, routes, domains, ownWorker: 'epoch' };

	it('finds the proxied hostnames and other Workers’ Custom Domains, but not one routed on its own', () => {
		const survey = surveyZone({ ...base, ownHostname: 'example.com' });
		expect(survey.captured).toEqual(['demo.example.com', 'www.example.com']);
		// `www.example.com/blog*` covers one path only, so the wildcard would still take the rest.
		expect(survey.covered).toEqual(['shop.example.com']);
		expect(survey.wildcard).toBeNull();
	});

	it('reserves the label under the zone of every explicit name, proxied or not', () => {
		expect(surveyZone({ ...base, ownHostname: 'example.com' }).reservedLabels).toEqual([
			'_dmarc',
			'_domainkey',
			'cf-bounce',
			'demo',
			'mail',
			'shop',
			'www'
		]);
	});

	it('never proposes an exclusion for the install’s own host, which would take the app off its Worker', () => {
		const survey = surveyZone({
			...base,
			domains: [...domains, { hostname: 'epoch.example.com', service: 'epoch' }],
			records: [
				...records,
				{
					id: 'r-own',
					name: 'epoch.example.com',
					type: 'AAAA',
					content: '100::',
					isProxied: true,
					comment: null
				}
			],
			ownHostname: 'epoch.example.com'
		});
		expect(survey.captured).not.toContain('epoch.example.com');
		expect(survey.reservedLabels).not.toContain('epoch');
	});

	it('sees an existing wildcard address record', () => {
		const wildcard: DnsRecord = {
			id: 'r-star',
			name: '*.example.com',
			type: 'AAAA',
			content: '100::',
			isProxied: true,
			comment: MARKER
		};
		const survey = surveyZone({ ...base, records: [...records, wildcard], ownHostname: 'x' });
		expect(survey.wildcard).toEqual(wildcard);
		expect(survey.captured).not.toContain('*.example.com');
	});
});

describe('the optional scopes', () => {
	it('are asked for at sign-in but not required, so an older sign-in keeps working', () => {
		for (const scope of SUBDOMAIN_SCOPES) {
			expect(BASE_SCOPES).toContain(scope);
			expect(requiredScopes('profile')).not.toContain(scope);
		}
	});
});

interface Zone {
	records: DnsRecord[];
	routes: ZoneRoute[];
	domains: WorkerDomain[];
}

/** A zone that answers like Cloudflare and remembers every write. */
function liveZone(initial: Partial<Zone> = {}, overrides: Partial<CloudflareApi> = {}) {
	const zone: Zone = {
		records: initial.records ?? records,
		routes: initial.routes ?? routes,
		domains: initial.domains ?? domains
	};
	const writes: string[] = [];
	const appBodies: Parameters<CloudflareApi['updateAccessApp']>[1][] = [];
	const cf = stubApi({
		whoami: async () => ({
			email: 'a@example.com',
			userId: 'u',
			accountIds: ['acc'],
			scopes: [...BASE_SCOPES]
		}),
		listActiveZones: async () => [ZONE, { id: 'zone2', name: 'other.example' }],
		listDnsRecords: async () => zone.records,
		listZoneRoutes: async () => zone.routes,
		listWorkerDomains: async () => zone.domains,
		createExclusionRoute: async (_zoneId, pattern) => {
			writes.push(`route + ${pattern}`);
			const route = { id: `route-${pattern}`, pattern, script: null };
			zone.routes = [...zone.routes, route];
			return route;
		},
		deleteZoneRoute: async (_zoneId, id) => {
			writes.push(`route - ${id}`);
			zone.routes = zone.routes.filter((r) => r.id !== id);
		},
		createDnsRecord: async (_zoneId, record) => {
			writes.push(`dns + ${record.name} ${record.type} ${record.content} ${record.comment}`);
			const created: DnsRecord = { ...record, id: 'rec-star' };
			zone.records = [...zone.records, created];
			return created;
		},
		deleteDnsRecord: async (_zoneId, id) => void writes.push(`dns - ${id}`),
		updateAccessApp: async (id, body) => {
			appBodies.push(body);
			writes.push(`access ${id}`);
			return {
				id,
				name: body.name,
				domain: body.domain,
				aud: 'aud-epoch',
				policyIds: body.policyIds,
				isPathCookieAttributeOn: false,
				isBindingCookieOn: false,
				destinations: [body.domain, ...(body.extraDestinations ?? [])]
			};
		},
		...overrides
	});
	return { cf, zone, writes, appBodies };
}

function withInstall(manifest: Manifest) {
	return memoryFs({
		...baseFiles(),
		[`${TEST_ROOT}/.epoch/install.json`]: JSON.stringify(manifest),
		[`${TEST_ROOT}/wrangler.jsonc`]:
			baseFiles()[`${TEST_ROOT}/tools/setup/templates/wrangler.template.jsonc`]!
	});
}

async function failure(work: () => Promise<unknown>): Promise<SetupError> {
	try {
		await work();
	} catch (error) {
		return error as SetupError;
	}
	throw new Error('did not throw');
}

describe('./setup subdomains', () => {
	it('refuses an install on workers.dev only: the wildcard needs a zone', async () => {
		const { ctx } = testContext({ cf: liveZone().cf });
		const error = await failure(() =>
			planSubdomains(ctx, { ...install, hosting: 'workers-dev' }, {}, YES, NO_ASKER as Asker)
		);
		expect(error.code).toBe(ERROR_CODES.prerequisite);
	});

	it('stops before reading the zone when the sign-in lacks dns.write', async () => {
		const { cf } = liveZone(
			{},
			{
				whoami: async () => ({
					email: null,
					userId: null,
					accountIds: [],
					scopes: BASE_SCOPES.filter((s) => s !== 'dns.write')
				}),
				listDnsRecords: async () => {
					throw new Error('read the zone');
				}
			}
		);
		const { ctx } = testContext({ cf });
		const error = await failure(() => planSubdomains(ctx, install, {}, YES, NO_ASKER as Asker));
		expect(error.code).toBe(ERROR_CODES.scopesMissing);
		expect(error.message).toContain('dns.write');
		expect(error.hint).toContain('./setup --force');
	});

	it('goes ahead under an API token, which reports no scopes', async () => {
		const { cf } = liveZone(
			{},
			{ whoami: async () => ({ email: null, userId: null, accountIds: [], scopes: null }) }
		);
		const { ctx } = testContext({ cf });
		await expect(planSubdomains(ctx, install, {}, YES, NO_ASKER as Asker)).resolves.toBeDefined();
	});

	it('plans the record, an exclusion route per captured host, the Access destination and the vars', async () => {
		const { ctx, report } = testContext({ cf: liveZone().cf });
		const plan = await planSubdomains(ctx, install, { reserve: ['Staff'] }, YES, NO_ASKER as Asker);
		expect(report.infos.join('\n')).toContain(
			'The wildcard route *.example.com/* would take, unless excluded: demo.example.com, www.example.com'
		);
		expect(plan.routesToCreate).toEqual(['demo.example.com/*', 'www.example.com/*']);
		expect(plan.isRecordCreated).toBe(true);
		expect(plan.settings).toEqual({
			zone: ZONE,
			reservedLabels: ['_dmarc', '_domainkey', 'cf-bounce', 'demo', 'mail', 'shop', 'staff', 'www'],
			appHost: null,
			dnsRecordId: null,
			exclusionRoutes: [],
			isActive: false
		});
		expect(plan.lines.map((l) => `${l.symbol} ${l.text}`)).toEqual([
			'+ create the proxied DNS record * AAAA 100:: on example.com',
			'+ create the route demo.example.com/* with no Worker',
			'+ create the route www.example.com/* with no Worker',
			'~ sign-in on *.example.com/login, added to the Access application Epoch (epoch) (same AUD)',
			'~ wrangler.deploy.jsonc: route *.example.com/*, EPOCH_TREE_HOST_ZONE=example.com, EPOCH_RESERVED_SUBDOMAINS=_dmarc,_domainkey,cf-bounce,demo,mail,shop,staff,www'
		]);
	});

	it('refuses a wildcard record this install did not make', async () => {
		const foreign: DnsRecord = {
			id: 'r-theirs',
			name: '*.example.com',
			type: 'CNAME',
			content: 'elsewhere.example.net',
			isProxied: true,
			comment: null
		};
		const { ctx } = testContext({ cf: liveZone({ records: [...records, foreign] }).cf });
		const error = await failure(() => planSubdomains(ctx, install, {}, YES, NO_ASKER as Asker));
		expect(error.code).toBe(ERROR_CODES.foreign);
	});

	it('needs --yes to add exclusion routes when there is no terminal to ask on', async () => {
		const { ctx } = testContext({ cf: liveZone().cf });
		const error = await failure(() =>
			planSubdomains(
				ctx,
				install,
				{ zone: 'example.com' },
				{ isYes: false, isInteractive: false },
				NO_ASKER as Asker
			)
		);
		expect(error.code).toBe(ERROR_CODES.missingAnswer);
		expect(error.flag).toBe('--yes');
	});

	it('offers a different zone, and stopping, when hostnames would be captured', async () => {
		const answers: unknown[] = [ZONE, 'other-zone', { id: 'zone2', name: 'other.example' }];
		const asker = {
			...NO_ASKER,
			select: async () => answers.shift()
		} as Asker;
		const { ctx } = testContext({
			cf: liveZone(
				{},
				{
					listDnsRecords: async (zoneId) => (zoneId === ZONE.id ? records : []),
					listZoneRoutes: async () => [],
					listWorkerDomains: async (zoneId) => (zoneId === ZONE.id ? domains : [])
				}
			).cf
		});
		const plan = await planSubdomains(
			ctx,
			install,
			{},
			{ isYes: false, isInteractive: true },
			asker
		);
		expect(plan.settings.zone).toEqual({ id: 'zone2', name: 'other.example' });
		expect(plan.routesToCreate).toEqual([]);
		// The app is not on the new zone, so it must be named for links back to it.
		expect(plan.settings.appHost).toBe('example.com');

		const stop = { ...NO_ASKER, select: async () => 'stop' } as Asker;
		const error = await failure(() =>
			planSubdomains(ctx, install, { zone: ZONE.id }, { isYes: false, isInteractive: true }, stop)
		);
		expect(error.code).toBe(ERROR_CODES.cancelled);
	});

	it('changes nothing under --plan', async () => {
		const live = liveZone();
		const { ctx, saved } = testContext({ cf: live.cf, fs: withInstall(install) });
		const result = await runSubdomains(
			ctx,
			{ isPlanOnly: true },
			YES,
			NO_ASKER as Asker,
			presenter
		);
		expect(result.isApplied).toBe(false);
		expect(live.writes).toEqual([]);
		expect(saved).toEqual([]);
	});

	it('applies: routes first, then the marked record and the destination, then the deploy config', async () => {
		const live = liveZone();
		const exec = fakeExec([{ match: 'node scripts/deploy-config.mjs', stdout: '' }]);
		const { ctx, fs } = testContext({ cf: live.cf, fs: withInstall(install), exec });
		const result = await runSubdomains(
			ctx,
			{ isPlanOnly: false },
			YES,
			NO_ASKER as Asker,
			presenter
		);
		expect(live.writes).toEqual([
			'route + demo.example.com/*',
			'route + www.example.com/*',
			`dns + *.example.com AAAA 100:: ${MARKER}`,
			'access app00000-0000-4000-8000-000000000002'
		]);
		expect(live.appBodies[0]).toMatchObject({
			domain: 'example.com/login',
			extraDestinations: ['*.example.com/login'],
			policyIds: ['pol1'],
			idpIds: ['idp1']
		});
		const settings = result.manifest!.subdomains!;
		expect(settings.dnsRecordId).toBe('rec-star');
		expect(settings.exclusionRoutes).toEqual([
			{ id: 'route-demo.example.com/*', pattern: 'demo.example.com/*', ownership: 'owned' },
			{ id: 'route-www.example.com/*', pattern: 'www.example.com/*', ownership: 'owned' }
		]);
		const deployConfig = fs.files[ctx.paths.deployConfigFile]!;
		expect(deployConfig).toContain('"*.example.com/*"');
		expect(deployConfig).toContain('"EPOCH_TREE_HOST_ZONE": "example.com"');
		expect(deployConfig).toContain('"EPOCH_RESERVED_SUBDOMAINS"');
	});

	it('a run that fails part-way leaves nothing that a deploy or ./setup would carry', async () => {
		let made = 0;
		const live = liveZone(
			{},
			{
				createExclusionRoute: async (_zoneId, pattern) => {
					made += 1;
					if (made === 2) throw new SetupError(ERROR_CODES.command, 'HTTP 409');
					return { id: `route-${pattern}`, pattern, script: null };
				}
			}
		);
		const { ctx, saved } = testContext({ cf: live.cf, fs: withInstall(install) });
		await expect(
			runSubdomains(ctx, { isPlanOnly: false }, YES, NO_ASKER as Asker, presenter)
		).rejects.toThrow('HTTP 409');
		const last = saved.at(-1)!;
		// The route that was made is recorded, so a re-run keeps it and teardown can find it.
		expect(last.subdomains?.exclusionRoutes.map((r) => r.id)).toEqual(['route-demo.example.com/*']);
		expect(last.subdomains?.isActive).toBe(false);
		expect(deployValuesOf(last).treeHostZone).toBeNull();
		expect(live.writes.filter((w) => w.startsWith('dns') || w.startsWith('access'))).toEqual([]);
	});

	it('refuses to move to another zone, which would lose the first zone’s record and routes', async () => {
		const { ctx } = testContext({ cf: liveZone().cf });
		const moved: Manifest = {
			...install,
			subdomains: {
				zone: ZONE,
				reservedLabels: [],
				appHost: null,
				dnsRecordId: 'rec-star',
				exclusionRoutes: [],
				isActive: true
			}
		};
		const error = await failure(() =>
			planSubdomains(ctx, moved, { zone: 'other.example' }, YES, NO_ASKER as Asker)
		);
		expect(error.code).toBe(ERROR_CODES.usage);
		expect(error.hint).toContain('./setup teardown');
	});

	it('a re-run finds everything it made and changes only the Access application', async () => {
		const first = liveZone();
		const exec = fakeExec([{ match: 'node scripts/deploy-config.mjs', stdout: '' }]);
		const once = testContext({ cf: first.cf, fs: withInstall(install), exec });
		const applied = await runSubdomains(
			once.ctx,
			{ isPlanOnly: false },
			YES,
			NO_ASKER as Asker,
			presenter
		);

		const again = liveZone(first.zone);
		const { ctx } = testContext({ cf: again.cf });
		const plan = await planSubdomains(ctx, applied.manifest!, {}, YES, NO_ASKER as Asker);
		expect(plan.routesToCreate).toEqual([]);
		expect(plan.routesToDelete).toEqual([]);
		expect(plan.isRecordCreated).toBe(false);
		expect(plan.settings).toEqual(applied.manifest!.subdomains);
	});

	it('deletes an exclusion route it made once nothing is proxied there, but never one it did not make', async () => {
		const previous: SubdomainSettings = {
			zone: ZONE,
			reservedLabels: ['old'],
			appHost: null,
			dnsRecordId: 'rec-star',
			exclusionRoutes: [{ id: 'r-old', pattern: 'old.example.com/*', ownership: 'owned' }],
			isActive: true
		};
		const { ctx } = testContext({
			cf: liveZone({
				records: [
					...records,
					{
						id: 'rec-star',
						name: '*.example.com',
						type: 'AAAA',
						content: '100::',
						isProxied: true,
						comment: MARKER
					}
				],
				routes: [
					...routes,
					{ id: 'r-old', pattern: 'old.example.com/*', script: null },
					{ id: 'r-hand', pattern: 'www.example.com/*', script: null }
				]
			}).cf
		});
		const plan = await planSubdomains(
			ctx,
			{ ...install, subdomains: previous },
			{},
			YES,
			NO_ASKER as Asker
		);
		expect(plan.routesToDelete.map((r) => r.id)).toEqual(['r-old']);
		expect(plan.routesToCreate).toEqual(['demo.example.com/*']);
		expect(plan.settings.exclusionRoutes).toEqual([
			{ id: 'r-hand', pattern: 'www.example.com/*', ownership: 'referenced' }
		]);
		// A label once reserved stays reserved: a tree may already be refused it.
		expect(plan.settings.reservedLabels).toContain('old');
	});
});

describe('a fresh clone', () => {
	it('takes the settings from the deploy config, so a re-run of ./setup keeps them', async () => {
		const { ctx } = testContext({ cf: liveZone().cf });
		const seeded = await seedSubdomains(ctx, install, {
			...NO_DEFAULTS,
			treeHostZone: 'example.com',
			reservedSubdomains: ['www', 'demo'],
			appHost: null
		});
		expect(seeded.subdomains).toEqual({
			zone: ZONE,
			reservedLabels: ['demo', 'www'],
			appHost: null,
			dnsRecordId: null,
			exclusionRoutes: [],
			isActive: true
		});
	});

	it('warns and leaves them out when the zone is not in the account', async () => {
		const { ctx, report } = testContext({ cf: liveZone().cf });
		const seeded = await seedSubdomains(ctx, install, {
			...NO_DEFAULTS,
			treeHostZone: 'gone.example'
		});
		expect(seeded.subdomains).toBeNull();
		expect(report.warnings[0]).toContain('gone.example');
	});
});

describe('teardown of the tree subdomains', () => {
	const settings: SubdomainSettings = {
		zone: ZONE,
		reservedLabels: [],
		appHost: null,
		dnsRecordId: 'rec-star',
		exclusionRoutes: [
			{ id: 'r-www', pattern: 'www.example.com/*', ownership: 'owned' },
			{ id: 'r-hand', pattern: 'demo.example.com/*', ownership: 'referenced' },
			{ id: 'r-taken', pattern: 'blog.example.com/*', ownership: 'owned' }
		],
		isActive: true
	};
	const manifest = { ...install, subdomains: settings };
	const zone = {
		records: [
			...records,
			{
				id: 'rec-star',
				name: '*.example.com',
				type: 'AAAA',
				content: '100::',
				isProxied: true,
				comment: MARKER
			},
			{
				id: 'rec-other',
				name: '*.example.com',
				type: 'AAAA',
				content: '100::',
				isProxied: true,
				comment: 'epoch:22222222-2222-4222-8222-222222222222'
			}
		],
		routes: [
			{ id: 'r-tree', pattern: '*.example.com/*', script: 'epoch' },
			{ id: 'r-www', pattern: 'www.example.com/*', script: null },
			{ id: 'r-hand', pattern: 'demo.example.com/*', script: null },
			// Ours once, but someone has since attached a Worker to it.
			{ id: 'r-taken', pattern: 'blog.example.com/*', script: 'blog' }
		]
	};

	it('finds only what is marked ours or was made by this install and is unchanged', async () => {
		const { ctx } = testContext({ cf: liveZone(zone).cf });
		const items = await planSubdomainTeardown(ctx, manifest, false, [
			'example.com/login',
			'*.example.com/login'
		]);
		expect(items).toEqual([
			{ key: 'dnsRecord', name: 'DNS record *.example.com', id: 'rec-star' },
			{ key: 'treeRoute', name: 'route *.example.com/*', id: 'r-tree' },
			{ key: 'exclusionRoute', name: 'route www.example.com/*', id: 'r-www' },
			{ key: 'accessDestination', name: 'Access destination *.example.com/login' }
		]);
	});

	it('leaves the destination to the application’s own deletion', async () => {
		const { ctx } = testContext({ cf: liveZone(zone).cf });
		const items = await planSubdomainTeardown(ctx, manifest, true, ['*.example.com/login']);
		expect(items.map((i) => i.key)).not.toContain('accessDestination');
	});

	it('warns and carries on when the zone cannot be read', async () => {
		const { ctx, report } = testContext({
			cf: liveZone(zone, {
				listDnsRecords: async () => {
					throw new Error('HTTP 403');
				}
			}).cf
		});
		const items = await planSubdomainTeardown(ctx, manifest, true, []);
		expect(items.map((i) => i.key)).toEqual(['treeRoute', 'exclusionRoute']);
		expect(report.warnings[0]).toContain('HTTP 403');
	});

	it('removes the destination by sending the app host alone', async () => {
		const live = liveZone(zone);
		const { ctx } = testContext({ cf: live.cf });
		await removeSubdomainItem(ctx, manifest, {
			key: 'accessDestination',
			name: 'Access destination *.example.com/login'
		});
		await removeSubdomainItem(ctx, manifest, { key: 'dnsRecord', name: 'r', id: 'rec-star' });
		expect(live.appBodies[0]).toMatchObject({
			domain: 'example.com/login',
			extraDestinations: []
		});
		expect(live.writes).toEqual(['access app00000-0000-4000-8000-000000000002', 'dns - rec-star']);
	});
});
