import { describe, expect, it } from 'vitest';
import { createCloudflareApi, type RawGet, type RawRequest } from './cloudflare.ts';
import { SetupError } from './errors.ts';
import { createRunner } from './run.ts';
import { fakeExec, fixture } from './testing.ts';

function api(rules: Parameters<typeof fakeExec>[0], rawGet?: RawGet) {
	const exec = fakeExec(rules);
	const cf = createCloudflareApi(createRunner(exec), { rawGet });
	cf.useAccount('acc0000000000000000000000000001');
	return { cf, exec };
}
const reply =
	(status: number, body: unknown): RawGet =>
	async () => ({ status, body });

describe('reading a Worker fails closed', () => {
	it('a 404 and the script-not-found error code both mean absent', async () => {
		expect(await api([], reply(404, null)).cf.getWorker('epoch')).toBeNull();
		expect(
			await api([], reply(400, { success: false, errors: [{ code: 10007 }] })).cf.getWorker('epoch')
		).toBeNull();
	});

	it.each([403, 500, 502])('HTTP %i is an error, never "absent"', async (status) => {
		await expect(
			api([], reply(status, { success: false, errors: [{ code: 10000 }] })).cf.getWorker('epoch')
		).rejects.toThrow(SetupError);
	});

	it('an unreadable body is an error too', async () => {
		await expect(api([], reply(200, null)).cf.getWorker('epoch')).rejects.toThrow(
			'Could not read the Worker'
		);
	});

	it('reads the bindings and the install marker var from the settings', async () => {
		const worker = await api(
			[],
			reply(200, { success: true, result: fixture('worker-settings-ours.json') })
		).cf.getWorker('epoch');
		expect(worker).toMatchObject({
			boundD1Id: 'd1d10000-0000-4000-8000-000000000001',
			boundR2Name: 'epoch-media',
			boundQueueName: 'epoch-import-queue',
			markerInstallId: '11111111-1111-4111-8111-111111111111'
		});
	});

	it('a hostname check that cannot list custom domains stops instead of calling the host free', async () => {
		await expect(
			api([], reply(500, null)).cf.findHostnameUse('zone', 'h.example.com', 'epoch')
		).rejects.toThrow('Could not list Workers custom domains');
	});

	it('our own Worker serving the hostname is not a clash; another Worker is', async () => {
		const own = reply(200, { result: [{ hostname: 'h.example.com', service: 'epoch' }] });
		expect(await api([], own).cf.findHostnameUse('zone', 'h.example.com', 'epoch')).toBeNull();
		const other = reply(200, { result: [{ hostname: 'h.example.com', service: 'theirs' }] });
		expect(await api([], other).cf.findHostnameUse('zone', 'h.example.com', 'epoch')).toContain(
			'theirs'
		);
	});
});

describe('whoami', () => {
	it('reads the shape cf prints, and treats `authenticated: false` (exit 0) as signed out', async () => {
		const signedIn = api([
			{
				match: 'cf auth whoami',
				stdout: {
					authenticated: true,
					tokenValid: true,
					email: 'a@example.com',
					accounts: [{ id: 'acc', name: 'A' }],
					scopes: ['account:read']
				}
			}
		]);
		expect(await signedIn.cf.whoami()).toEqual({
			email: 'a@example.com',
			userId: null,
			accountIds: ['acc'],
			scopes: ['account:read']
		});
		const signedOut = api([
			{ match: 'cf auth whoami', stdout: { authenticated: false, error: 'Not logged in' } }
		]);
		await expect(signedOut.cf.whoami()).rejects.toThrow('not signed in');
	});

	it('an API token has no scopes to report', async () => {
		const { cf } = api([
			{
				match: 'cf auth whoami',
				stdout: { authenticated: true, tokenValid: true, email: 'a@example.com', accounts: [] }
			}
		]);
		expect((await cf.whoami()).scopes).toBeNull();
	});
});

describe('argv shapes (from `cf schema`)', () => {
	const app = { id: 'a', name: 'n', domain: 'h/login', aud: 'x' };

	it('Zero Trust commands take no scope positionals; the account comes from the environment', async () => {
		const { cf, exec } = api([
			{ match: 'cf zero-trust access applications create', stdout: app },
			{
				match: 'cf zero-trust access policies create',
				stdout: { id: 'p', name: 'n', decision: 'allow', include: [] }
			},
			{
				match: 'cf zero-trust access policies update',
				stdout: { id: 'p', name: 'n', decision: 'allow', include: [] }
			},
			{ match: 'cf zero-trust access policies list', stdout: [] },
			{ match: 'cf zero-trust access policies delete', stdout: {} }
		]);
		await cf.createAccessApp({
			name: 'n',
			domain: 'h/login',
			policyIds: [],
			idpIds: [],
			isAutoRedirect: false
		});
		await cf.createPolicy('n', []);
		await cf.updatePolicy(
			{
				id: 'p1',
				name: 'n',
				decision: 'allow',
				include: [],
				exclude: [],
				require: [],
				appNames: []
			},
			[]
		);
		await cf.listPolicies();
		await cf.deletePolicy('p1');
		const lines = exec.calls.map((c) => c.args.join(' '));
		expect(lines[0]).toMatch(/^zero-trust access applications create --body /);
		expect(lines[1]).toMatch(/^zero-trust access policies create --body /);
		expect(lines[2]).toMatch(/^zero-trust access policies update p1 --body /);
		expect(lines[3]).toBe('zero-trust access policies list --per-page 100');
		expect(lines[4]).toBe('zero-trust access policies delete p1');
	});

	it('a jurisdictional R2 bucket is made with wrangler, because cf’s body has no jurisdiction', async () => {
		const { cf, exec } = api([{ match: 'wrangler r2 bucket create', stdout: '' }]);
		await cf.createR2Bucket('epoch-media', 'weur', 'eu');
		expect(exec.calls[0]?.args).toEqual([
			'r2',
			'bucket',
			'create',
			'epoch-media',
			'--jurisdiction',
			'eu',
			'--location',
			'weur'
		]);
	});

	it('minting a deploy token resolves permission groups by name and refuses if one is missing', async () => {
		const groups = [
			'Workers Scripts Write',
			'D1 Write',
			'Workers R2 Storage Write',
			'Queues Write',
			'Workers Routes Write',
			'DNS Write',
			'Zone Read'
		].map((name, i) => ({ id: `g${i}`, name }));
		const ok = api([
			{ match: 'cf accounts tokens permission-groups list', stdout: groups },
			{ match: 'cf accounts tokens create', stdout: { id: 't1', value: 'secret-value-1234' } }
		]);
		expect(
			await ok.cf.mintDeployToken('epoch-epoch-setup-1', new Date('2026-10-09T01:00:00Z'), 'zone1')
		).toEqual({ id: 't1', value: 'secret-value-1234' });
		const create = ok.exec.calls.find((c) => c.args[2] === 'create')!;
		expect(create.hasSecretOutput).toBe(true);
		const body = JSON.parse(create.args[create.args.indexOf('--body') + 1]!);
		expect(body.policies).toHaveLength(2);
		expect(body.policies[1].resources).toEqual({ 'com.cloudflare.api.account.zone.zone1': '*' });

		const missing = api([
			{ match: 'cf accounts tokens permission-groups list', stdout: groups.slice(1) }
		]);
		await expect(missing.cf.mintDeployToken('x', new Date(), 'zone1')).rejects.toThrow(
			'"Workers Scripts Write"'
		);
	});
});

describe('the permission and token fixes from the real spike run', () => {
	it('a 403 / 9109 is a missing permission, not a sign-in problem', async () => {
		const { mapFailure } = await import('./run.ts');
		const stderr =
			'┌ APIError\n│ [9109] Unauthorized to access requested resource\n│ 403 Forbidden · HTTP /accounts/x/tokens/permission_groups';
		expect(mapFailure(stderr, 'cf accounts tokens permission-groups list')).toBe(
			'This login lacks the permission for `cf accounts tokens permission-groups list`'
		);
		expect(mapFailure('401 Unauthorized: token expired')).toContain('Not signed in');
	});

	it('takes the token from banner-plus-token output, and refuses garbage', async () => {
		const { extractToken } = await import('./wrangler.ts');
		const token = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd';
		expect(extractToken(`\n ⛅️ wrangler 4.148.0\n-------------------\n${token}\n`)).toBe(token);
		expect(extractToken(`⛅️ wrangler 4.148.0\n{"token":"${token}"}`)).toBe(token);
		expect(() => extractToken('⛅️ wrangler 4.148.0\n')).toThrow('usable token');
	});
});

describe('R2 lifecycle rules', () => {
	const account = 'acc0000000000000000000000000001';

	function withRaw(rawRequest: RawRequest) {
		const cf = createCloudflareApi(createRunner(fakeExec([])), { rawRequest });
		cf.useAccount(account);
		return cf;
	}

	it('reads the documented `{ result: { rules } }` shape, and a 404 as no rules', async () => {
		const seen: Array<{ method: string; path: string }> = [];
		const cf = withRaw(async (method, path) => {
			seen.push({ method, path });
			return {
				status: 200,
				body: { result: { rules: [{ id: 'r', conditions: { prefix: 'exports/' } }] } }
			};
		});
		expect(await cf.getR2Lifecycle('epoch-media')).toEqual([
			{ id: 'r', conditions: { prefix: 'exports/' } }
		]);
		expect(seen[0]).toEqual({
			method: 'GET',
			path: `/accounts/${account}/r2/buckets/epoch-media/lifecycle`
		});
		expect(await withRaw(async () => ({ status: 404, body: null })).getR2Lifecycle('b')).toEqual(
			[]
		);
	});

	it('refuses to read “no rules” from a broken response', async () => {
		await expect(
			withRaw(async () => ({ status: 500, body: null })).getR2Lifecycle('b')
		).rejects.toThrow(SetupError);
	});

	it('throws on a 200 whose body is not the documented shape, rather than dropping rules', async () => {
		await expect(
			withRaw(async () => ({ status: 200, body: { result: {} } })).getR2Lifecycle('b')
		).rejects.toThrow(SetupError);
		await expect(
			withRaw(async () => ({ status: 200, body: { success: true } })).getR2Lifecycle('b')
		).rejects.toThrow(SetupError);
	});

	it('writes the rules as `{ rules }`, and fails loudly on an error', async () => {
		const bodies: unknown[] = [];
		const cf = withRaw(async (_method, _path, body) => {
			bodies.push(body);
			return { status: 200, body: { success: true } };
		});
		await cf.putR2Lifecycle('b', [{ conditions: { prefix: 'exports/' } }]);
		expect(bodies[0]).toEqual({ rules: [{ conditions: { prefix: 'exports/' } }] });
		await expect(
			withRaw(async () => ({ status: 403, body: null })).putR2Lifecycle('b', [])
		).rejects.toThrow(SetupError);
	});

	it('never writes under --dry-run', async () => {
		const calls: string[] = [];
		const cf = createCloudflareApi(createRunner(fakeExec([])), {
			rawRequest: async (method) => {
				calls.push(method);
				return { status: 200, body: {} };
			},
			isDryRun: true
		});
		cf.useAccount(account);
		await cf.putR2Lifecycle('b', []);
		expect(calls).toEqual([]);
	});
});

describe('Workers Builds triggers', () => {
	it('reads the shape the owner’s account printed, and drops deleted triggers', async () => {
		const live = fixture('build-trigger.json') as Record<string, unknown>;
		const deleted = { ...live, trigger_uuid: 'gone', deleted_on: '2026-10-06T00:00:00Z' };
		const { cf } = api([{ match: 'cf builds triggers list', stdout: [live, deleted] }]);
		expect(await cf.listBuildTriggers('a'.repeat(32))).toEqual([
			{
				id: 'b0000000-0000-4000-8000-000000000001',
				name: 'a'.repeat(32),
				buildCommand: 'npm run build',
				deployCommand: 'npm run deploy',
				branchIncludes: ['main'],
				pathIncludes: ['src/**'],
				pathExcludes: ['node_modules/**', '.git/', 'docs/', '.agents/', '.claude/']
			}
		]);
	});

	it('updates commands and paths with the flags `cf builds triggers update` takes', async () => {
		const { cf, exec } = api([{ match: 'cf builds triggers update', stdout: {} }]);
		await cf.updateBuildTrigger('trig', {
			buildCommand: 'npm run build:worker',
			deployCommand: 'npm run deploy:worker',
			pathIncludes: ['src/**'],
			pathExcludes: ['docs/', '.git/']
		});
		expect(exec.calls[0]?.args).toEqual([
			'builds',
			'triggers',
			'update',
			'trig',
			'--build-command',
			'npm run build:worker',
			'--deploy-command',
			'npm run deploy:worker',
			'--path-includes',
			'src/**',
			'--path-excludes',
			'docs/',
			'--path-excludes',
			'.git/'
		]);
	});
});

describe('tree subdomains (ADR-057)', () => {
	const zone = 'zone00000000000000000000000000001';

	function withRequests(
		answer: (method: string, path: string) => { status: number; body: unknown }
	) {
		const calls: { method: string; path: string; body: unknown }[] = [];
		const rawRequest: RawRequest = async (method, path, body) => {
			calls.push({ method, path, body });
			return answer(method, path);
		};
		const cf = createCloudflareApi(createRunner(fakeExec([])), { rawRequest });
		cf.useAccount('acc0000000000000000000000000001');
		return { cf, calls };
	}

	it('reads every page of DNS records, so a record past the first still counts', async () => {
		const page = Array.from({ length: 500 }, (_, i) => ({
			id: `r${i}`,
			name: `h${i}.example.com`,
			type: 'A',
			content: '192.0.2.1',
			proxied: false
		}));
		const { cf, exec } = api([
			{ match: /--page 1$/, stdout: page },
			{ match: /--page 2$/, stdout: fixture('dns-records-list.json') }
		]);
		const records = await cf.listDnsRecords(zone);
		expect(records).toHaveLength(507);
		expect(exec.calls[0]?.args).toEqual([
			'dns',
			'records',
			'list',
			'--zone',
			zone,
			'--per-page',
			'500',
			'--page',
			'1'
		]);
		expect(records.find((r) => r.name === 'www.example.com')).toEqual({
			id: 'rec00000000000000000000000000001',
			name: 'www.example.com',
			type: 'AAAA',
			content: '100::',
			isProxied: true,
			comment: null
		});
	});

	it('creates the wildcard record proxied, with its marker in the comment', async () => {
		const { cf, exec } = api([
			{ match: 'cf dns records create', stdout: { id: 'rec-new', name: '*.example.com' } }
		]);
		const record = await cf.createDnsRecord(zone, {
			type: 'AAAA',
			name: '*.example.com',
			content: '100::',
			isProxied: true,
			comment: 'epoch:11111111-1111-4111-8111-111111111111'
		});
		expect(record.id).toBe('rec-new');
		const args = exec.calls[0]!.args;
		expect(args.slice(0, 5)).toEqual(['dns', 'records', 'create', '--zone', zone]);
		expect(JSON.parse(args[args.indexOf('--body') + 1]!)).toEqual({
			type: 'AAAA',
			name: '*.example.com',
			content: '100::',
			proxied: true,
			ttl: 1,
			comment: 'epoch:11111111-1111-4111-8111-111111111111'
		});
	});

	it('deletes a record by id on its zone', async () => {
		const { cf, exec } = api([{ match: 'cf dns records delete', stdout: {} }]);
		await cf.deleteDnsRecord(zone, 'rec-1');
		expect(exec.calls[0]?.args).toEqual(['dns', 'records', 'delete', 'rec-1', '--zone', zone]);
	});

	it('lists routes and Custom Domains through the API, which cf has no command for', async () => {
		const { cf, calls } = withRequests((_method, path) => ({
			status: 200,
			body: fixture(
				path.includes('/routes') ? 'workers-routes-list.json' : 'workers-domains-list.json'
			)
		}));
		expect(await cf.listZoneRoutes(zone)).toEqual([
			{ id: 'route0000000000000000000000000001', pattern: 'shop.example.com/*', script: 'shop' },
			{ id: 'route0000000000000000000000000002', pattern: 'www.example.com/blog*', script: 'blog' }
		]);
		expect(await cf.listWorkerDomains(zone)).toContainEqual({
			hostname: 'www.example.com',
			service: 'website'
		});
		expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
			`GET /zones/${zone}/workers/routes`,
			`GET /accounts/acc0000000000000000000000000001/workers/domains?zone_id=${zone}`
		]);
	});

	it('makes an exclusion route with no script, so it attaches no Worker', async () => {
		const { cf, calls } = withRequests(() => ({
			status: 200,
			body: { success: true, result: { id: 'route-new', pattern: 'www.example.com/*' } }
		}));
		expect(await cf.createExclusionRoute(zone, 'www.example.com/*')).toEqual({
			id: 'route-new',
			pattern: 'www.example.com/*',
			script: null
		});
		await cf.deleteZoneRoute(zone, 'route-new');
		expect(calls).toEqual([
			{
				method: 'POST',
				path: `/zones/${zone}/workers/routes`,
				body: { pattern: 'www.example.com/*' }
			},
			{ method: 'DELETE', path: `/zones/${zone}/workers/routes/route-new`, body: undefined }
		]);
	});

	it('a failed route call stops with what it was doing', async () => {
		const { cf } = withRequests(() => ({ status: 409, body: { success: false } }));
		await expect(cf.createExclusionRoute(zone, 'www.example.com/*')).rejects.toThrow(
			'Could not add the route www.example.com/* (HTTP 409)'
		);
	});

	it('never writes a route under --dry-run', async () => {
		const calls: string[] = [];
		const cf = createCloudflareApi(createRunner(fakeExec([])), {
			rawRequest: async (method) => {
				calls.push(method);
				return { status: 200, body: {} };
			},
			isDryRun: true
		});
		await cf.createExclusionRoute(zone, 'www.example.com/*');
		await cf.deleteZoneRoute(zone, 'r');
		expect(calls).toEqual([]);
	});

	describe('Access destinations', () => {
		const app = { name: 'n', domain: 'example.com/login', policyIds: [], idpIds: [] };
		const bodyOf = (exec: ReturnType<typeof api>['exec']) => {
			const args = exec.calls[0]!.args;
			return JSON.parse(args[args.indexOf('--body') + 1]!) as Record<string, unknown>;
		};

		it('sends the application as before when there are no extra destinations', async () => {
			const { cf, exec } = api([
				{ match: 'cf zero-trust access applications update', stdout: { id: 'a', aud: 'x' } }
			]);
			await cf.updateAccessApp('a', { ...app, isAutoRedirect: false });
			expect(bodyOf(exec)).not.toHaveProperty('destinations');
		});

		it('lists the app host first and the tree subdomains after it', async () => {
			const { cf, exec } = api([
				{ match: 'cf zero-trust access applications update', stdout: { id: 'a', aud: 'x' } }
			]);
			await cf.updateAccessApp('a', {
				...app,
				extraDestinations: ['*.example.com/login'],
				isAutoRedirect: false
			});
			expect(bodyOf(exec)).toMatchObject({
				domain: 'example.com/login',
				destinations: [
					{ type: 'public', uri: 'example.com/login' },
					{ type: 'public', uri: '*.example.com/login' }
				]
			});
		});

		it('names only the app host when the extra destinations are emptied', async () => {
			const { cf, exec } = api([
				{ match: 'cf zero-trust access applications update', stdout: { id: 'a', aud: 'x' } }
			]);
			await cf.updateAccessApp('a', { ...app, extraDestinations: [], isAutoRedirect: false });
			expect(bodyOf(exec).destinations).toEqual([{ type: 'public', uri: 'example.com/login' }]);
		});

		it('reads destinations back, or the domain alone from an application without them', async () => {
			const { cf } = api([
				{
					match: 'cf zero-trust access applications list',
					stdout: [
						{
							id: 'a',
							domain: 'example.com/login',
							destinations: [
								{ type: 'public', uri: 'example.com/login' },
								{ type: 'public', uri: '*.example.com/login' },
								{ type: 'private', hostname: 'internal' }
							]
						},
						{ id: 'b', domain: 'other.example.com/login' }
					]
				}
			]);
			const apps = await cf.listAccessApps();
			expect(apps.map((a) => a.destinations)).toEqual([
				['example.com/login', '*.example.com/login'],
				['other.example.com/login']
			]);
		});
	});
});
