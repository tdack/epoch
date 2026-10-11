import { describe, expect, it } from 'vitest';
import type { Asker } from './asker.ts';
import type { CloudflareApi, Identity } from './cloudflare.ts';
import { ERROR_CODES, SetupError } from './errors.ts';
import {
	assertValidWorkerName,
	derivedNameSummary,
	resourceNames,
	suggestAlternativeName
} from './names.ts';
import { DEFAULT_FLAGS, type Answers, type SetupFlags } from './options.ts';
import { RESOURCE_STATES, reconcile, type Observed } from './reconcile.ts';
import { collect } from './steps/collect.ts';
import {
	WORKER_CHOICES,
	canAdoptWorker,
	resolveExistingWorker,
	workerPanel
} from './steps/existing-worker.ts';
import { chooseWorkerName, readDeployDefaults } from './steps/name.ts';
import { preflight } from './steps/preflight.ts';
import {
	NO_ASKER,
	TEST_ROOT,
	baseFiles,
	fixture,
	memoryFs,
	stubApi,
	testContext,
	testManifest
} from './testing.ts';

const flags = (over: Partial<SetupFlags> = {}): SetupFlags => ({ ...DEFAULT_FLAGS, ...over });
const YES = { isYes: true, isInteractive: false };
const NO_TTY = { isYes: false, isInteractive: false };
const TTY = { isYes: false, isInteractive: true };
const identity: Identity = {
	email: 'a@example.com',
	userId: null,
	accountIds: ['acc'],
	scopes: []
};
const policies = (fixture('access-policies.json') as any[]).map((p) => ({ ...p, appNames: [] }));

async function failure(work: () => unknown): Promise<SetupError> {
	try {
		await work();
	} catch (error) {
		return error as SetupError;
	}
	throw new Error('did not throw');
}

describe('Worker names', () => {
	it('derive every other name', () => {
		expect(resourceNames('shop')).toMatchObject({
			worker: 'shop',
			d1: 'shop-db',
			r2: 'shop-media',
			queue: 'shop-import-queue',
			workflow: 'shop-export-workflow',
			accessApp: 'Epoch (shop)',
			profile: 'epoch-shop'
		});
		expect(derivedNameSummary('shop')).toContain('D1 shop-db');
	});

	it.each(['Shop', 'my worker', '-lead', 'trail-', '', 'x'.repeat(48)])('rejects %j', (name) => {
		expect(() => assertValidWorkerName(name)).toThrow(SetupError);
	});
	it.each(['epoch', 'epoch-genealogy', 'a', 'x'.repeat(47)])('accepts %j', (name) => {
		expect(() => assertValidWorkerName(name)).not.toThrow();
	});

	it('suggests the next free-looking name', () => {
		expect(suggestAlternativeName('epoch')).toBe('epoch-2');
		expect(suggestAlternativeName('epoch-2')).toBe('epoch-3');
	});
});

describe('choosing the name', () => {
	const none = {} as never;
	it('prefers --name, then the install here, then the deploy config, then epoch', async () => {
		const deployConfig = JSON.stringify({ name: 'from-deploy', workers_dev: true });
		const fs = memoryFs({ ...baseFiles(), [`${TEST_ROOT}/wrangler.deploy.jsonc`]: deployConfig });
		const { ctx } = testContext({ fs });
		const defaults = readDeployDefaults(ctx);
		expect(await chooseWorkerName(ctx, flags({ name: 'flagged' }), YES, none, defaults)).toBe(
			'flagged'
		);
		expect(await chooseWorkerName(ctx, flags(), YES, none, defaults)).toBe('from-deploy');
		expect(
			await chooseWorkerName(
				testContext().ctx,
				flags(),
				YES,
				none,
				readDeployDefaults(testContext().ctx)
			)
		).toBe('epoch');
	});

	it('without a terminal and without --yes, names --name', async () => {
		const { ctx } = testContext();
		const error = await failure(() =>
			chooseWorkerName(ctx, flags(), NO_TTY, none, readDeployDefaults(ctx))
		);
		expect(error.flag).toBe('--name');
	});

	it('asks on a terminal, showing the derived names, and validates', async () => {
		const asked: { message: string; validate?: (v: string) => string | undefined }[] = [];
		const asker = { ...NO_ASKER, text: async (o: any) => (asked.push(o), 'shop') } as Asker;
		const { ctx, report } = testContext();
		expect(await chooseWorkerName(ctx, flags(), TTY, asker, readDeployDefaults(ctx))).toBe('shop');
		expect(asked[0]?.message).toContain('epoch-db');
		expect(asked[0]?.validate?.('Bad Name')).toContain('lowercase');
		expect(report.infos.at(-1)).toContain('shop-db');
	});

	it('an empty or hand-written deploy config only supplies what it has', () => {
		const fs = memoryFs({ ...baseFiles(), [`${TEST_ROOT}/wrangler.deploy.jsonc`]: '' });
		expect(readDeployDefaults(testContext({ fs }).ctx).workerName).toBeNull();
	});

	it('choosing another name after a taken one replaces the empty record instead of calling it a second install', () => {
		const abandoned = JSON.stringify(testManifest({ workerName: 'epoch' }));
		const fs = memoryFs({ ...baseFiles(), [`${TEST_ROOT}/.epoch/install.json`]: abandoned });
		const result = preflight(testContext({ fs }).ctx, flags({ name: 'epoch-2' }));
		expect(result.manifest.workerName).toBe('epoch-2');
		expect(result.isResume).toBe(false);
	});
});

describe('hosting', () => {
	function api(over: Partial<CloudflareApi> = {}) {
		return stubApi({
			listAccounts: async () => [{ id: 'acc', name: 'A' }],
			getWorkersSubdomain: async () => 'me',
			listActiveZones: async () => [{ id: 'z1', name: 'example.com' }],
			getTeamDomain: async () => 'team.cloudflareaccess.com',
			listIdentityProviders: async () => [{ id: 'i1', name: 'OTP', type: 'onetimepin' }],
			findHostnameUse: async () => null,
			listPolicies: async () => policies,
			listAccessApps: async () => [],
			listEmailSenderDomains: async () => [],
			...over
		});
	}
	const run = (cf: CloudflareApi, f: Partial<SetupFlags>, mode = YES) =>
		collect(
			testContext({ cf }).ctx,
			testManifest({ workerName: 'shop' }),
			flags(f),
			identity,
			mode,
			NO_ASKER as Asker
		);

	it('workers.dev only: the host comes from the name and the account subdomain, with no zone', async () => {
		const { answers, manifest } = await run(api(), { hosting: 'workers-dev' });
		expect(answers).toMatchObject({
			hosting: 'workers-dev',
			hostname: 'shop.me.workers.dev',
			zone: null,
			isWorkersDevKept: false,
			emailSender: null
		});
		expect(manifest.hosting).toBe('workers-dev');
	});

	it('workers.dev never checks for a hostname clash', async () => {
		await run(
			api({ findHostnameUse: async () => Promise.reject(new Error('must not be called')) }),
			{ hosting: 'workers-dev' }
		);
	});

	it('custom domain: workers.dev stays off unless asked', async () => {
		expect((await run(api(), { hosting: 'custom' })).answers).toMatchObject({
			hosting: 'custom',
			hostname: 'shop.example.com',
			isWorkersDevKept: false
		});
		expect(
			(await run(api(), { hosting: 'custom', isKeepWorkersDev: true })).answers.isWorkersDevKept
		).toBe(true);
	});

	it('offers only what the account supports', async () => {
		const noSub = api({ getWorkersSubdomain: async () => null });
		expect((await run(noSub, {})).answers.hosting).toBe('custom');
		expect((await failure(() => run(noSub, { hosting: 'workers-dev' }))).flag).toBe('--hosting');
		const noZone = api({ listActiveZones: async () => [] });
		expect((await run(noZone, {})).answers.hosting).toBe('workers-dev');
		expect((await failure(() => run(noZone, { hosting: 'custom' }))).flag).toBe('--hosting');
	});

	it('stops when the account has neither, and never sets a subdomain', async () => {
		const error = await failure(() =>
			run(api({ getWorkersSubdomain: async () => null, listActiveZones: async () => [] }), {})
		);
		expect(error.code).toBe(ERROR_CODES.prerequisite);
	});

	it('cannot keep workers.dev on when no subdomain is set', async () => {
		const error = await failure(() =>
			run(api({ getWorkersSubdomain: async () => null }), {
				hosting: 'custom',
				isKeepWorkersDev: true
			})
		);
		expect(error.code).toBe(ERROR_CODES.prerequisite);
	});

	it('asks which hosting on a terminal when both are possible', async () => {
		const asker = {
			...NO_ASKER,
			text: async () => 'a@example.com',
			multiselect: async (o: any) => (o.initial.length > 0 ? o.initial : ['__new__']),
			select: async (o: any) =>
				o.choices.map((c: any) => c.value).includes('workers-dev') ? 'workers-dev' : 'x'
		} as Asker;
		const out = await collect(
			testContext({ cf: api() }).ctx,
			testManifest({ workerName: 'shop' }),
			flags(),
			identity,
			TTY,
			asker
		);
		expect(out.answers.hosting).toBe('workers-dev');
	});

	it('adopting the live install: the app on this host’s /login keeps its policy as the default', async () => {
		const cf = api({
			listAccessApps: async () => [
				{
					id: 'app',
					name: 'epoch-genealogy - Cloudflare Workers',
					domain: 'epoch-genealogy.me.workers.dev/login',
					aud: 'aud',
					policyIds: [policies[0].id],
					isPathCookieAttributeOn: false,
					isBindingCookieOn: false
				}
			]
		});
		const out = await collect(
			testContext({ cf }).ctx,
			testManifest({ workerName: 'epoch-genealogy' }),
			flags({ hosting: 'workers-dev' }),
			identity,
			YES,
			NO_ASKER as Asker
		);
		expect(out.answers.hostname).toBe('epoch-genealogy.me.workers.dev');
		expect(out.answers.policy).toEqual({ existingIds: [policies[0].id], isNewPolicy: false });
	});
});

describe('an existing Worker with the chosen name', () => {
	const names = resourceNames('epoch');
	const worker = {
		name: 'epoch',
		lastDeployedAt: '2026-09-30',
		markerInstallId: null,
		boundD1Id: 'old-d1',
		boundR2Name: 'shop-media',
		boundQueueName: null
	};
	const observed: Observed = {
		d1: null,
		r2: null,
		worker,
		queue: null,
		accessApp: null,
		accessPolicy: null
	};
	const result = reconcile({ manifest: null, names, hostname: 'epoch.example.com', observed });
	const answers = {
		workerName: 'epoch',
		hostname: 'epoch.example.com',
		typedAdoptions: {}
	} as Answers;
	const { report } = testContext();

	it('is foreign when bound to another database, and can then be renamed or replaced but not adopted', () => {
		expect(result.reports.worker.state).toBe(RESOURCE_STATES.foreign);
		expect(canAdoptWorker(worker, observed)).toBe(false);
		expect(canAdoptWorker({ ...worker, boundD1Id: null }, observed)).toBe(true);
	});

	it('--yes refuses, and so does a run without a terminal (naming --name)', async () => {
		expect(
			(
				await failure(() =>
					resolveExistingWorker(worker, observed, result, answers, YES, NO_ASKER as Asker, report)
				)
			).code
		).toBe(ERROR_CODES.needsTypedConfirmation);
		expect(
			(
				await failure(() =>
					resolveExistingWorker(
						worker,
						observed,
						result,
						answers,
						NO_TTY,
						NO_ASKER as Asker,
						report
					)
				)
			).flag
		).toBe('--name');
	});

	it('rename is the default choice and suggests a name', async () => {
		let selected: any;
		let suggestion = '';
		const asker = {
			...NO_ASKER,
			select: async (o: any) => ((selected = o), WORKER_CHOICES.rename),
			text: async (o: any) => ((suggestion = o.initial), 'epoch-2')
		} as Asker;
		const out = await resolveExistingWorker(
			worker,
			observed,
			result,
			answers,
			TTY,
			asker,
			testContext().report
		);
		expect(selected.initial).toBe('rename');
		expect(selected.choices.map((c: any) => c.value)).toEqual(['rename', 'replace']);
		expect(suggestion).toBe('epoch-2');
		expect(out).toEqual({ choice: 'rename', newName: 'epoch-2' });
	});

	it('replace shows the panel, then needs the name typed and a separate confirm', async () => {
		const events: string[] = [];
		const ctx = testContext();
		const asker = {
			...NO_ASKER,
			select: async () => WORKER_CHOICES.replace,
			text: async (o: any) => (events.push(`type: ${o.message}`), 'epoch'),
			confirm: async (o: any) => (events.push(`confirm: ${o.message}`), true)
		} as Asker;
		const out = await resolveExistingWorker(
			worker,
			observed,
			result,
			answers,
			TTY,
			asker,
			ctx.report
		);
		expect(events).toEqual(['type: Type "epoch" to continue', 'confirm: Overwrite Worker epoch?']);
		expect(ctx.report.infos.at(-1)).toContain(
			'Bound D1 old-d1  no longer bound to this Worker; NOT deleted'
		);
		expect(ctx.report.infos.at(-1)).toContain('wrangler rollback');
		expect(out).toMatchObject({
			choice: 'replace',
			answers: { typedAdoptions: { worker: 'epoch' } }
		});
	});

	it('declining the confirmation changes nothing', async () => {
		const asker = {
			...NO_ASKER,
			select: async () => WORKER_CHOICES.replace,
			text: async () => 'epoch',
			confirm: async () => false
		} as Asker;
		const error = await failure(() =>
			resolveExistingWorker(worker, observed, result, answers, TTY, asker, testContext().report)
		);
		expect(error.code).toBe(ERROR_CODES.cancelled);
	});

	it('the panel lists what is created', () => {
		const lines = workerPanel('replace', worker, observed, result, answers).join('\n');
		expect(lines).toContain('+ Create  epoch-db, epoch-media, epoch-import-queue');
		expect(lines).toContain('protected from this deploy on');
	});
});

describe('writing the deploy config from nothing', () => {
	it('uses the shipped template when there is no tracked file, shows the change, and runs the build-field check', async () => {
		const { writeConfig } = await import('./steps/write-config.ts');
		const { fakeExec } = await import('./testing.ts');
		const exec = fakeExec([{ match: 'node scripts/deploy-config.mjs', stdout: '' }]);
		const { ctx, fs, report } = testContext({ exec });
		const manifest = testManifest({
			workerName: 'shop',
			hosting: 'workers-dev',
			hostname: 'shop.me.workers.dev',
			teamDomain: 't.cloudflareaccess.com',
			resources: { d1: { id: 'd1id', name: 'shop-db' }, r2: null, queue: null, worker: null }
		});
		await writeConfig(ctx, manifest);
		const written = fs.files[`${TEST_ROOT}/wrangler.deploy.jsonc`]!;
		expect(written).toContain('"name": "shop"');
		expect(written).toContain('"workers_dev": true');
		expect(report.infos.join('\n')).toContain('shipped with the setup tool');
		expect(report.infos.join('\n')).toContain('+ ');
		expect(exec.calls.at(-1)?.args).toEqual(['scripts/deploy-config.mjs']);
	});

	it('stops with the script’s own message when the build fields disagree', async () => {
		const { writeConfig } = await import('./steps/write-config.ts');
		const { fakeExec } = await import('./testing.ts');
		const exec = fakeExec([
			{ match: 'node scripts/deploy-config.mjs', exitCode: 1, stderr: 'disagrees on main' }
		]);
		const manifest = testManifest({
			hosting: 'custom',
			hostname: 'h.example.com',
			teamDomain: 't',
			resources: { d1: { id: 'x', name: 'x' }, r2: null, queue: null, worker: null }
		});
		await expect(writeConfig(testContext({ exec }).ctx, manifest)).rejects.toThrow(
			'disagrees on main'
		);
	});
});

describe('the raw Workers reads and the deploy config hint', () => {
	it('under --deploy-auth=ephemeral they fail early and clearly, without ever asking for a token', async () => {
		const { createContext } = await import('./app.ts');
		const { fakeExec } = await import('./testing.ts');
		const exec = fakeExec([]);
		const ctx = createContext({
			reporter: testContext().report,
			isVerbose: false,
			isReadOnly: true,
			exec,
			deployAuth: 'ephemeral',
			root: TEST_ROOT
		});
		ctx.cf.useAccount('acc');
		const error = await failure(() => ctx.cf.getWorker('epoch'));
		expect(error.flag).toBe('--deploy-auth');
		expect(exec.calls).toEqual([]);
	});

	it('warns about a database the deploy config names that setup would not use', async () => {
		const { reconcileStep } = await import('./steps/reconcile.ts');
		const cf = stubApi({
			findD1: async () => null,
			getD1: async () => ({ id: 'old', name: 'shop-db', createdAt: null, sizeBytes: null }),
			findR2Bucket: async () => null,
			getWorker: async () => null,
			findQueue: async () => null,
			listAccessApps: async () => [],
			listPolicies: async () => []
		});
		const { ctx, report } = testContext({ cf });
		const answers = { hostname: 'epoch.example.com', typedAdoptions: {} } as Answers;
		await reconcileStep(ctx, testManifest(), answers, false, 'old');
		expect(report.warnings.join('\n')).toContain('points at database shop-db (old)');
	});
});

describe('re-running with nothing changed', () => {
	it('reports "unchanged" and does not write the file', async () => {
		const { writeConfig } = await import('./steps/write-config.ts');
		const { fakeExec } = await import('./testing.ts');
		const manifest = testManifest({
			workerName: 'shop',
			hosting: 'workers-dev',
			hostname: 'shop.me.workers.dev',
			teamDomain: 't.cloudflareaccess.com',
			resources: { d1: { id: 'd1id', name: 'shop-db' }, r2: null, queue: null, worker: null }
		});
		const exec = fakeExec([{ match: 'node scripts/deploy-config.mjs', stdout: '' }]);
		const first = testContext({ exec });
		await writeConfig(first.ctx, manifest);
		const written = first.fs.files[`${TEST_ROOT}/wrangler.deploy.jsonc`]!;

		const second = testContext({
			exec,
			fs: memoryFs({ ...baseFiles(), [`${TEST_ROOT}/wrangler.deploy.jsonc`]: written })
		});
		let writes = 0;
		const write = second.fs.write;
		second.fs.write = (path, text) => (writes++, write(path, text));
		await writeConfig(second.ctx, manifest);
		expect(writes).toBe(0);
		expect(second.report.infos).toContain('wrangler.deploy.jsonc unchanged');
		expect(second.fs.files[`${TEST_ROOT}/wrangler.deploy.jsonc`]).toBe(written);
	});
});
