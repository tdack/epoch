import { describe, expect, it } from 'vitest';
import { changeAllowedEmail } from './allow.ts';
import type { Asker } from './asker.ts';
import { buildProgram, toFlags, type Handlers } from './cli.ts';
import { runDoctor } from './doctor.ts';
import { ERROR_CODES, SetupError } from './errors.ts';
import { AUTH_MODES, OWNERSHIPS, type Manifest } from './manifest.ts';
import { DEFAULT_FLAGS } from './options.ts';
import { planTeardown, runTeardown } from './teardown.ts';
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
} from './testing.ts';

const manifestPath = `${TEST_ROOT}/.epoch/install.json`;
function withManifest(manifest: Manifest) {
	return memoryFs({ ...baseFiles(), [manifestPath]: JSON.stringify(manifest) });
}
async function failure(work: () => unknown): Promise<SetupError> {
	try {
		await work();
	} catch (error) {
		return error as SetupError;
	}
	throw new Error('did not throw');
}

describe('allow and disallow', () => {
	const policy = {
		id: 'own',
		name: 'Epoch epoch sign-in',
		decision: 'allow',
		include: [{ email: { email: 'a@example.com' } }],
		exclude: [],
		require: [],
		appNames: []
	};

	it('edit the policy setup created', async () => {
		const updates: unknown[] = [];
		const manifest = testManifest({
			account: { id: 'acc', name: 'A' },
			access: {
				app: null,
				idps: [],
				policies: [{ id: 'own', name: policy.name, ownership: OWNERSHIPS.owned }]
			}
		});
		const { ctx } = testContext({
			fs: withManifest(manifest),
			cf: stubApi({
				listPolicies: async () => [policy],
				updatePolicy: async (_p, include) => void updates.push(include) as never
			})
		});
		await changeAllowedEmail(ctx, 'add', 'B@Example.com');
		expect(updates).toEqual([
			[{ email: { email: 'a@example.com' } }, { email: { email: 'b@example.com' } }]
		]);
	});

	it('refuse a policy the user picked from the existing ones, and never reach Cloudflare', async () => {
		const manifest = testManifest({
			account: { id: 'acc', name: 'A' },
			access: {
				app: null,
				idps: [],
				policies: [{ id: 'family', name: 'Family', ownership: OWNERSHIPS.referenced }]
			}
		});
		const exec = fakeExec([]);
		const { ctx } = testContext({ fs: withManifest(manifest), exec });
		const error = await failure(() => changeAllowedEmail(ctx, 'add', 'b@example.com'));
		expect(error.message).toContain('did not create');
		expect(exec.calls).toEqual([]);
	});
});

describe('doctor', () => {
	it('says so when there is no install here', async () => {
		expect((await failure(() => runDoctor(testContext().ctx))).code).toBe(ERROR_CODES.manifest);
	});

	it('reports the Access cookie settings that were changed in the dashboard', async () => {
		const manifest = testManifest({
			account: { id: 'acc', name: 'A' },
			zone: { id: 'z', name: 'example.com' },
			hostname: 'epoch.example.com',
			teamDomain: 'team.cloudflareaccess.com',
			access: {
				app: {
					id: 'app00000-0000-4000-8000-000000000002',
					name: 'Epoch (epoch)',
					aud: 'aud-epoch'
				},
				policies: [
					{
						id: 'pol00000-0000-4000-8000-000000000003',
						name: 'Bypass the world',
						ownership: OWNERSHIPS.referenced
					}
				],
				idps: []
			}
		});
		const drifted = (fixture('access-apps.json') as any[]).map((a) => ({
			...a,
			path_cookie_attribute: true
		}));
		const exec = fakeExec([
			{ match: 'cf d1 list', stdout: [] },
			{ match: 'cf r2 buckets list', stdout: [] },
			{ match: 'cf queues list', stdout: [] },
			{ match: 'cf zero-trust access applications list', stdout: drifted },
			{ match: 'cf zero-trust access policies list', stdout: fixture('access-policies.json') }
		]);
		const { ctx } = testContext({
			fs: withManifest(manifest),
			exec,
			cf: undefined,
			fetch: (async () => {
				throw new TypeError('down');
			}) as typeof fetch
		});
		const original = ctx.cf;
		ctx.cf = new Proxy(original, {
			get: (t, p: string) =>
				p === 'whoami'
					? async () => ({ email: 'a@example.com', userId: 'u', accountIds: ['acc'], scopes: null })
					: p === 'getTeamDomain'
						? async () => 'team'
						: p === 'listIdentityProviders'
							? async () => [{ id: 'i', name: 'n', type: 't' }]
							: p === 'listActiveZones'
								? async () => [{ id: 'z', name: 'example.com' }]
								: (t as any)[p]
		});
		const { findings } = await runDoctor(ctx);
		const text = findings.map((f) => `${f.level}: ${f.text}`).join('\n');
		expect(text).toContain('fail: Access application: Cookie Path Attribute is off');
		expect(text).toContain('ok: Access application: Binding Cookie is off');
		expect(text).toContain('is now bypass, so it admits nobody');
	});
});

const ourWorker = () => ({
	status: 200,
	body: { success: true, result: fixture('worker-settings-ours.json') }
});

describe('teardown', () => {
	const manifest = testManifest({
		authMode: AUTH_MODES.profile,
		account: { id: 'acc', name: 'A' },
		hostname: 'epoch.example.com',
		resources: {
			d1: { id: 'd1d10000-0000-4000-8000-000000000001', name: 'epoch-db' },
			r2: { name: 'epoch-media' },
			queue: { id: 'queue0000000000000000000000001', name: 'epoch-import-queue' },
			worker: { name: 'epoch' }
		},
		markersWritten: ['d1', 'r2', 'worker'],
		access: {
			app: { id: 'app00000-0000-4000-8000-000000000002', name: 'Epoch (epoch)', aud: 'aud-epoch' },
			policies: [],
			idps: []
		}
	});
	const OURS = manifest.installId;
	function rules(d1Marker: string) {
		return [
			{ match: 'cf d1 list', stdout: fixture('d1-list.json') },
			{
				match: 'cf d1 query',
				stdout: [{ results: [{ n: 1, install_id: d1Marker, owner_email: 'a@example.com' }] }]
			},
			{ match: 'cf r2 buckets list', stdout: { buckets: [{ name: 'epoch-media' }] } },
			{ match: 'cf r2 objects list', stdout: { objects: [] } },
			{ match: 'wrangler r2 object get', stdout: JSON.stringify({ installId: OURS }) },
			{ match: 'cf queues list', stdout: fixture('queues-list.json') },
			{ match: 'cf queues consumers list', stdout: fixture('queue-consumers-ours.json') },
			{ match: 'cf zero-trust access applications list', stdout: fixture('access-apps.json') },
			{ match: 'cf zero-trust access policies list', stdout: fixture('access-policies.json') }
		];
	}

	it('--yes and non-interactive runs are refused: teardown always needs typed names', async () => {
		const { ctx } = testContext({
			fs: withManifest(manifest),
			exec: fakeExec(rules(OURS)),
			raw: ourWorker
		});
		for (const mode of [
			{ isYes: true, isInteractive: false },
			{ isYes: false, isInteractive: false }
		]) {
			expect((await failure(() => runTeardown(ctx, mode, NO_ASKER as Asker))).code).toBe(
				ERROR_CODES.needsTypedConfirmation
			);
		}
	});

	it('plans to delete only what its marker proves is ours', async () => {
		const { ctx } = testContext({ exec: fakeExec(rules(OURS)), raw: ourWorker });
		const items = await planTeardown(ctx, manifest);
		expect(items.map((i) => i.key).sort()).toEqual(['accessApp', 'd1', 'queue', 'r2', 'worker']);
		expect(
			items
				.filter((i) => i.isIrreversible)
				.map((i) => i.key)
				.sort()
		).toEqual(['d1', 'r2']);
	});

	it('leaves a database whose marker names another install', async () => {
		const other = '22222222-2222-4222-8222-222222222222';
		const { ctx } = testContext({ exec: fakeExec(rules(other)), raw: ourWorker });
		const items = await planTeardown(ctx, manifest);
		expect(items.map((i) => i.key)).not.toContain('d1');
	});

	it('asks for the slug and then each irreversible name before deleting anything', async () => {
		const asked: string[] = [];
		const deleted: string[] = [];
		const asker = {
			...NO_ASKER,
			text: async ({ message }: { message: string }) => void asked.push(message) as never
		} as Asker;
		const { ctx } = testContext({
			fs: withManifest(manifest),
			exec: fakeExec(rules(OURS)),
			raw: ourWorker,
			wrangler: { deleteWorker: async (n) => void deleted.push(`worker ${n}`) }
		});
		ctx.cf = new Proxy(ctx.cf, {
			get: (t, p: string) =>
				p.startsWith('delete')
					? async (id: string) => void deleted.push(`${p} ${id}`)
					: (t as any)[p]
		});
		await runTeardown(ctx, { isYes: false, isInteractive: true }, asker);
		expect(asked).toHaveLength(3);
		expect(asked[0]).toContain('slug');
		expect(deleted).toEqual([
			'deleteAccessApp app00000-0000-4000-8000-000000000002',
			'worker epoch',
			'deleteQueue queue0000000000000000000000001',
			'deleteR2Bucket epoch-media',
			'deleteD1 d1d10000-0000-4000-8000-000000000001'
		]);
	});
});

describe('command line', () => {
	it('maps every flag, with the --no- forms arriving as false', () => {
		expect(
			toFlags({
				yes: true,
				newPolicy: true,
				apiTokenEnv: true,
				browser: false,
				device: false,
				deployAuth: 'ephemeral',
				d1Location: 'oc',
				policy: ['a'],
				idp: ['i'],
				slug: 's',
				account: 'a',
				zone: 'z',
				hostname: 'h'
			})
		).toMatchObject({
			isYes: true,
			isNewPolicy: true,
			isApiTokenEnv: true,
			isBrowser: false,
			isDevice: false,
			deployAuth: 'ephemeral',
			d1Location: 'oc',
			policy: ['a'],
			idp: ['i'],
			slug: 's',
			account: 'a',
			zone: 'z',
			hostname: 'h'
		});
		expect(toFlags({})).toEqual(
			expect.objectContaining({ isBrowser: DEFAULT_FLAGS.isBrowser, isDevice: true, isYes: false })
		);
	});

	it('lists the commands and the setup flags in --help', () => {
		const help = buildProgram().helpInformation();
		for (const word of [
			'doctor',
			'allow',
			'disallow',
			'teardown',
			'spike',
			'--plan',
			'--yes',
			'--json',
			'--verbose',
			'--account',
			'--zone',
			'--hostname',
			'--policy',
			'--new-policy',
			'--idp',
			'--d1-location',
			'--deploy-auth',
			'--api-token-env',
			'--no-browser',
			'--no-device',
			'--slug'
		]) {
			expect(help).toContain(word);
		}
	});

	it('parses the setup flags at the top level, so `npm run setup -- --plan` works', async () => {
		const program = buildProgram();
		program.exitOverride();
		const parsed = program.parseOptions([
			'--plan',
			'--zone',
			'example.com',
			'--no-browser',
			'--policy',
			'a',
			'b'
		]);
		expect(parsed.unknown).toEqual([]);
		expect(program.opts()).toMatchObject({
			plan: true,
			zone: 'example.com',
			browser: false,
			policy: ['a', 'b']
		});
	});

	describe('which command gets which flags', () => {
		function spied() {
			const calls: { command: string; args: unknown[] }[] = [];
			const record =
				(command: string) =>
				async (...args: unknown[]) =>
					void calls.push({ command, args });
			const handlers = {
				setup: record('setup'),
				doctor: record('doctor'),
				allow: record('allow'),
				teardown: record('teardown'),
				spike: record('spike')
			} as unknown as Handlers;
			return { calls, program: buildProgram(handlers) };
		}
		const run = (argv: string[]) => {
			const { calls, program } = spied();
			return program.parseAsync(argv, { from: 'user' }).then(() => calls);
		};

		it('`setup --plan` plans: the flag reaches the setup command, not the program', async () => {
			const [call] = await run(['setup', '--plan', '--zone', 'example.com']);
			expect(call?.command).toBe('setup');
			expect(call?.args[0]).toMatchObject({ plan: true, zone: 'example.com' });
		});

		it('with no command, setup flags reach the default action', async () => {
			const [call] = await run(['--plan', '--yes']);
			expect(call?.command).toBe('setup');
			expect(call?.args[0]).toMatchObject({ plan: true, yes: true });
		});

		it('`doctor --json` and `teardown --yes` keep their flags', async () => {
			expect((await run(['doctor', '--json']))[0]?.args[0]).toMatchObject({ json: true });
			const teardown = (await run(['teardown', '--yes']))[0];
			expect(teardown?.command).toBe('teardown');
			expect(teardown?.args[0]).toMatchObject({ yes: true });
		});

		it('allow and disallow pass the action and the address', async () => {
			expect((await run(['allow', 'b@example.com']))[0]?.args.slice(0, 2)).toEqual([
				'add',
				'b@example.com'
			]);
			expect((await run(['disallow', 'b@example.com']))[0]?.args.slice(0, 2)).toEqual([
				'remove',
				'b@example.com'
			]);
		});
	});
});
