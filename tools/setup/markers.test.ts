import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Asker } from './asker.ts';
import { createCloudflareApi } from './cloudflare.ts';
import { NIL_UUID, realMarker } from './install-meta.ts';
import { resourceNames } from './names.ts';
import { DEFAULT_FLAGS, type SetupFlags } from './options.ts';
import { installPaths } from './paths.ts';
import { RESOURCE_STATES, reconcile, type Observed } from './reconcile.ts';
import { createExec, createRedactor, createRunner } from './run.ts';
import { collect } from './steps/collect.ts';
import { NO_ASKER, fakeExec, fixture, stubApi, testContext, testManifest } from './testing.ts';

const names = resourceNames('epoch-genealogy');

describe('the nil UUID is no marker', () => {
	it('reads as absent', () => {
		expect(realMarker(NIL_UUID)).toBeNull();
		expect(realMarker(NIL_UUID.toUpperCase())).toBeNull();
		expect(realMarker('')).toBeNull();
		expect(realMarker('3c1d4f7e-5b2a-4c8d-9e6f-0a1b2c3d4e5f')).toBe(
			'3c1d4f7e-5b2a-4c8d-9e6f-0a1b2c3d4e5f'
		);
	});

	it('a Worker var holding the placeholder is not a marker', async () => {
		const cf = createCloudflareApi(createRunner(fakeExec([])), {
			rawGet: async () => ({
				status: 200,
				body: {
					result: {
						bindings: [
							{ type: 'plain_text', name: 'EPOCH_INSTALL_ID', text: NIL_UUID },
							{ type: 'd1', id: 'x' }
						]
					}
				}
			})
		});
		cf.useAccount('acc');
		expect((await cf.getWorker('epoch-genealogy'))?.markerInstallId).toBeNull();
	});
});

describe('a manifest id that was never written anywhere', () => {
	// The owner's live run: placeholder on the Worker, a hand-inserted row in D1, a fresh manifest.
	const MANIFEST_ID = 'de1eb2a4-0000-4000-8000-000000000000';
	const ROW_ID = '3c1d4f7e-5b2a-4c8d-9e6f-0a1b2c3d4e5f';
	const observed: Observed = {
		d1: {
			id: 'd1',
			name: names.d1,
			createdAt: null,
			markerInstallId: ROW_ID,
			migrationsApplied: 25,
			migrationsExpected: 25,
			trees: 1,
			people: 1,
			users: 1,
			ownerEmails: [],
			sizeBytes: 1
		},
		r2: {
			name: names.r2,
			createdAt: null,
			markerInstallId: realMarker(null),
			objectCount: 1,
			sizeBytes: 1,
			sampleKeys: []
		},
		worker: {
			name: names.worker,
			lastDeployedAt: null,
			markerInstallId: realMarker(NIL_UUID),
			boundD1Id: 'd1',
			boundR2Name: names.r2,
			boundQueueName: names.queue
		},
		queue: null,
		accessApp: null,
		accessPolicy: null
	};
	const empty = testManifest({ installId: MANIFEST_ID });

	it('does not make the lone marker foreign: it is orphaned, and its UUID is adopted', () => {
		const result = reconcile({ manifest: empty, names, hostname: 'h.example.com', observed });
		expect(result.refusals).toEqual([]);
		expect(result.reports.d1.state).toBe(RESOURCE_STATES.orphaned);
		expect(result.installId).toBe(ROW_ID);
	});

	it('a manifest with history still treats a different marker as foreign', () => {
		const used = testManifest({ installId: MANIFEST_ID, markersWritten: ['r2'] });
		const result = reconcile({ manifest: used, names, hostname: 'h.example.com', observed });
		expect(result.reports.d1.state).toBe(RESOURCE_STATES.foreign);
	});
});

describe('r2 objects list', () => {
	it('takes the bucket as --bucket-name, not a positional', async () => {
		const exec = fakeExec([{ match: 'cf r2 objects list', stdout: { objects: [] } }]);
		const cf = createCloudflareApi(createRunner(exec), {});
		cf.useAccount('acc');
		await cf.listR2Objects('epoch-media', 20);
		expect(exec.calls[0]?.args).toEqual([
			'r2',
			'objects',
			'list',
			'--bucket-name',
			'epoch-media',
			'--per-page',
			'20'
		]);
	});
});

describe('the real exec', () => {
	const dirs: string[] = [];
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});
	function realExec(isVerbose: boolean) {
		const dir = mkdtempSync(join(tmpdir(), 'epoch-exec-'));
		dirs.push(dir);
		const logFile = join(dir, 'log.txt');
		// The guard exists to stop tests reaching a real account; here the only child is `node -e`.
		vi.stubEnv('VITEST', '');
		const paths = { ...installPaths(dir), root: dir };
		return { logFile, exec: createExec({ paths, logFile, isVerbose, redactor: createRedactor() }) };
	}

	it('writes each command’s block whole, even when commands run in parallel', async () => {
		const { exec, logFile } = realExec(false);
		const script = (tag: string, wait: number) =>
			`setTimeout(()=>{console.error('${tag}-err');console.log('${tag}-out')},${wait})`;
		await Promise.all([
			exec({ tool: 'node', args: ['-e', script('slow', 120)] }),
			exec({ tool: 'node', args: ['-e', script('fast', 10)] })
		]);
		const blocks = readFileSync(logFile, 'utf8').split('\n$ ').filter(Boolean);
		expect(blocks).toHaveLength(2);
		for (const block of blocks) {
			const tag = block.includes('slow-out') ? 'slow' : 'fast';
			expect(block).toContain(`${tag}-err`);
			expect(block).not.toContain(tag === 'slow' ? 'fast-' : 'slow-');
		}
	});

	it('logs a probe’s stderr but never echoes it, even with --verbose', async () => {
		const { exec, logFile } = realExec(true);
		const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
		await exec({
			tool: 'node',
			args: ['-e', "console.error('the specified key does not exist');process.exit(1)"],
			isProbe: true
		});
		await exec({ tool: 'node', args: ['-e', "console.error('loud failure')"] });
		const echoed = write.mock.calls.map((call) => String(call[0])).join('');
		expect(echoed).not.toContain('key does not exist');
		expect(echoed).toContain('loud failure');
		expect(readFileSync(logFile, 'utf8')).toContain('key does not exist');
	});
});

describe('the policy picker', () => {
	const policies = (fixture('access-policies.json') as any[]).map((p) => ({ ...p, appNames: [] }));
	const identity = { email: 'a@example.com', userId: null, accountIds: ['acc'], scopes: [] };
	const flags = (over: Partial<SetupFlags> = {}): SetupFlags => ({
		...DEFAULT_FLAGS,
		hosting: 'workers-dev',
		...over
	});
	const api = (apps: any[] = []) =>
		stubApi({
			listAccounts: async () => [{ id: 'acc', name: 'A' }],
			getWorkersSubdomain: async () => 'me',
			listActiveZones: async () => [],
			getTeamDomain: async () => 't',
			listIdentityProviders: async () => [{ id: 'i', name: 'n', type: 't' }],
			listPolicies: async () => policies,
			listAccessApps: async () => apps,
			listEmailSenderDomains: async () => []
		});
	const app = {
		id: 'a',
		name: 'Epoch app',
		domain: 'shop.me.workers.dev/login',
		aud: 'x',
		policyIds: [policies[0].id],
		isPathCookieAttributeOn: false,
		isBindingCookieOn: false
	};

	async function ask(apps: any[]) {
		const seen: any[] = [];
		const asker = {
			...NO_ASKER,
			text: async () => 'a@example.com',
			select: async () => null,
			multiselect: async (o: any) => (
				seen.push(o),
				o.message.includes('Access policy') ? ['__new__'] : o.initial
			)
		} as Asker;
		await collect(
			testContext({ cf: api(apps) }).ctx,
			testManifest({ workerName: 'shop' }),
			flags(),
			identity,
			{ isYes: false, isInteractive: true },
			asker
		);
		return seen.find((o) => o.message.includes('Access policy'));
	}

	it('pre-ticks nothing when there is no application to adopt', async () => {
		const picker = await ask([]);
		expect(picker.initial).toEqual([]);
		expect(picker.isRequired).toBe(true);
		expect(picker.message).toContain('Space to tick one or more, Enter to confirm');
	});

	it('pre-ticks only the adopted application’s own policies, marked (current)', async () => {
		const picker = await ask([app]);
		expect(picker.initial).toEqual([policies[0].id]);
		expect(picker.choices.find((c: any) => c.value === policies[0].id).label).toContain(
			'(current)'
		);
		expect(picker.choices.find((c: any) => c.value === policies[1].id).label).not.toContain(
			'(current)'
		);
	});

	it('without a terminal and without --policy: the adopted app’s policies, else a new one, never another app’s', async () => {
		const run = (apps: any[]) =>
			collect(
				testContext({ cf: api(apps) }).ctx,
				testManifest({ workerName: 'shop' }),
				flags({ isYes: true }),
				identity,
				{ isYes: true, isInteractive: false },
				NO_ASKER as Asker
			);
		expect((await run([app])).answers.policy).toEqual({
			existingIds: [policies[0].id],
			isNewPolicy: false
		});
		expect((await run([])).answers.policy).toEqual({ existingIds: [], isNewPolicy: true });
	});
});
