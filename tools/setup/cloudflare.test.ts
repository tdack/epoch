import { describe, expect, it } from 'vitest';
import { createCloudflareApi, type RawGet } from './cloudflare.ts';
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

	it('Access applications and Zero Trust reads take `accounts <id>` positionals; policies do not', async () => {
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
		expect(lines[0]).toMatch(
			/^zero-trust access applications create accounts acc0000000000000000000000000001 --body /
		);
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
