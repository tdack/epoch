import { mkdirSync, writeFileSync } from 'node:fs';
import { createContext } from './app.ts';
import { createCloudflareApi } from './cloudflare.ts';
import type { Reporter, StepContext } from './context.ts';
import { FINDING_LEVELS, type Finding } from './doctor.ts';
import { isMissingTable } from './install-meta.ts';
import { loadManifest } from './manifest.ts';
import { resourceNames, type ResourceNames } from './names.ts';
import { readDeployDefaults } from './steps/name.ts';
import { installPaths } from './paths.ts';
import { createExec, createRedactor, type Exec, type ExecResult } from './run.ts';
import { BASE_SCOPES, TAG_SCOPES } from './scopes.ts';
import { TagConflictError } from './errors.ts';
import { TAG_KEYS } from './tags.ts';

/**
 * `npm run setup -- spike`: the plan's step 0, run once by the owner against their own account.
 * Everything is read-only; writes are only ever sent with `--dry-run`, except `tag-write-etag-412`,
 * which creates a throwaway queue, tags it twice and deletes both again. Each raw response is saved
 * under `.epoch/spike/` (git-ignored) so a test fixture can be replaced with the real shape.
 */
interface SpikeState {
	accountId: string | null;
	d1Id: string | null;
	/** Whose resources the checks look for: --name, the manifest, the deploy config, then the live install. */
	names: ResourceNames;
	lastResult: ExecResult | null;
}

interface Check {
	id: string;
	/** The assumption this settles, written the way the code relies on it. */
	claim: string;
	run(ctx: StepContext, state: SpikeState): Promise<string>;
}

/** The live install this repository's owner runs, used when nothing else says whose resources to look for. */
const LIVE_INSTALL_NAME = 'epoch-genealogy';

class Skip extends Error {}

const CHECKS: Check[] = [
	{
		id: 'whoami-shape',
		claim: '`cf auth whoami --json` reports an email and the granted OAuth scopes',
		async run(ctx) {
			const identity = await ctx.cf.whoami();
			if (identity.scopes === null)
				throw new Error('no scopes reported; setup will warn instead of checking them');
			// The tag scopes are checked on their own below: a profile signed in before they existed must still pass here.
			const missing = BASE_SCOPES.filter(
				(scope) =>
					!identity.scopes?.includes(scope) && !(TAG_SCOPES as readonly string[]).includes(scope)
			);
			if (missing.length > 0)
				throw new Error(`scopes not granted or named differently: ${missing.join(', ')}`);
			return `${identity.email ?? 'no email'}, ${identity.scopes.length} scopes, all requested names present`;
		}
	},
	{
		id: 'accounts-and-zones',
		claim:
			'`cf accounts list` and `cf zones list` print arrays of {id,name} (and status) that the code can read',
		async run(ctx, state) {
			const accounts = await ctx.cf.listAccounts();
			state.accountId =
				loadManifest(ctx.fs, ctx.paths.manifestFile)?.account?.id ?? accounts[0]?.id ?? null;
			if (!state.accountId) throw new Error('no account visible');
			ctx.cf.useAccount(state.accountId);
			const zones = await ctx.cf.listActiveZones();
			return `${accounts.length} account(s), ${zones.length} active zone(s)`;
		}
	},
	{
		id: 'zero-trust-org',
		claim:
			'`cf zero-trust organization get accounts <id>` returns `auth_domain`, and Access endpoints accept the OAuth login',
		async run(ctx) {
			const domain = await ctx.cf.getTeamDomain();
			if (!domain)
				throw new Error(
					'no auth_domain returned (no organisation, a missing scope, or a different positional form)'
				);
			return domain;
		}
	},
	{
		id: 'identity-providers',
		claim:
			'`cf zero-trust identity-providers list accounts <id>` returns providers with id, name and type',
		async run(ctx) {
			const idps = await ctx.cf.listIdentityProviders();
			if (idps.length === 0) throw new Error('empty list (or the positional form differs)');
			return idps.map((i) => i.type).join(', ');
		}
	},
	{
		id: 'access-policies-and-apps',
		claim:
			'Policies list with `decision` and `include` rules; apps list with `domain`, `aud` and `policies`',
		async run(ctx) {
			const [policies, apps] = await Promise.all([ctx.cf.listPolicies(), ctx.cf.listAccessApps()]);
			const withRules = policies.filter((p) => p.include.length > 0).length;
			const withAud = apps.filter((a) => a.aud !== '').length;
			return `${policies.length} policies (${withRules} with include rules), ${apps.length} apps (${withAud} with aud)`;
		}
	},
	{
		id: 'd1-list-and-query',
		claim: '`cf d1 list --name` reads CLOUDFLARE_ACCOUNT_ID; `cf d1 query <id> --sql` returns rows',
		async run(ctx, state) {
			const name = state.names.d1;
			const db = await ctx.cf.findD1(name);
			if (!db) throw new Skip(`no D1 named ${name}; pass --name for an existing install`);
			state.d1Id = db.id;
			const rows = await ctx.cf.queryD1(db.id, 'SELECT 1 AS n');
			return `found ${db.id}, SELECT 1 returned ${JSON.stringify(rows)}`;
		}
	},
	{
		id: 'install-meta-readable',
		claim:
			'The install_meta marker reads back through `cf d1 query`; a missing table is the only error treated as "marker pending"',
		async run(ctx, state) {
			if (!state.d1Id) throw new Skip('no D1 to read');
			try {
				const rows = await ctx.cf.queryD1(
					state.d1Id,
					'SELECT install_id FROM install_meta LIMIT 1'
				);
				return `table exists, ${rows.length} row(s)`;
			} catch (error) {
				// Only the SQLite message for a missing table counts; any other failure is a real failure.
				if (isMissingTable(String((error as Error).message)))
					return 'no install_meta table yet (marker pending, as the code expects)';
				throw error;
			}
		}
	},
	{
		id: 'worker-settings-read',
		claim:
			'GET /accounts/{id}/workers/scripts/{name}/settings (the only way to read a Worker) returns bindings including the d1 id and EPOCH_INSTALL_ID, using `wrangler auth token`',
		async run(ctx, state) {
			const name = state.names.worker;
			const worker = await ctx.cf.getWorker(name);
			if (!worker)
				throw new Skip(
					`no Worker named ${name} to read (the 404 path parsed); name an existing one by running after an install`
				);
			if (worker.boundD1Id === null)
				throw new Error(`${name} read back with no D1 binding; the bindings shape differs`);
			return `d1 ${worker.boundD1Id}, marker ${worker.markerInstallId ?? 'none'}`;
		}
	},
	{
		id: 'r2-and-queues',
		claim:
			'`cf r2 buckets list` and `cf queues list` print the shapes the reconcile observers read',
		async run(ctx, state) {
			const { r2: bucket, queue } = state.names;
			if (!(await ctx.cf.findR2Bucket(bucket)))
				throw new Skip(`no bucket ${bucket}; pass --name for an existing install`);
			if (!(await ctx.cf.findQueue(queue)))
				throw new Skip(`no queue ${queue}; pass --name for an existing install`);
			return 'both found';
		}
	},
	{
		id: 'permission-groups',
		claim:
			'The token permission group names the (currently disabled) ephemeral deploy token needs all exist',
		async run(ctx) {
			// A login without the token scope cannot even list the groups; that is a SKIP, not a failure.
			const missing = await ctx.cf.missingDeployPermissionGroups().catch((error: Error) => {
				if (/lacks (the|a) permission/i.test(error.message))
					throw new Skip(`scope not granted to this login (${error.message})`);
				throw error;
			});
			if (missing.length > 0)
				throw new Error(`not offered under these names: ${missing.join(', ')}`);
			return 'every group name resolves';
		}
	},
	{
		id: 'workers-subdomain',
		claim:
			'GET /accounts/{id}/workers/subdomain (no cf command) returns result.subdomain, or 404 when none is set',
		async run(ctx) {
			const subdomain = await ctx.cf.getWorkersSubdomain();
			return subdomain ? `subdomain ${subdomain}` : 'none set (the 404 path parsed)';
		}
	},
	{
		id: 'hostname-checks',
		claim:
			'`cf workers domains list` and `cf dns records list --zone --name` answer the collision check',
		async run(ctx) {
			const zones = await ctx.cf.listActiveZones();
			if (!zones[0]) throw new Skip('no active zone');
			const clash = await ctx.cf.findHostnameUse(
				zones[0].id,
				`epoch-spike-none.${zones[0].name}`,
				'none'
			);
			return clash ?? 'a free hostname reads as free';
		}
	},
	{
		id: 'email-sending',
		claim: '`cf email-sending subdomains list --zone` reports which sender subdomains are verified',
		async run(ctx) {
			const zones = await ctx.cf.listActiveZones();
			if (!zones[0]) throw new Skip('no active zone');
			const domains = await ctx.cf.listEmailSenderDomains(zones[0].id);
			return `${domains.length} domain(s), ${domains.filter((d) => d.isVerified).length} verified`;
		}
	},
	{
		id: 'writes-accept-dry-run',
		claim:
			'The argv for every create (d1, r2, queue, policy, application) is accepted by `cf --dry-run`',
		async run(ctx, state) {
			const probe = createCloudflareApi(ctx.runner, { isDryRun: true });
			probe.useAccount(state.accountId ?? '');
			const failures: string[] = [];
			const attempts: [string, () => Promise<unknown>][] = [
				['d1 create', () => probe.createD1('epoch-spike-dry', null)],
				['r2 buckets create', () => probe.createR2Bucket('epoch-spike-dry', null, null)],
				['queues create', () => probe.createQueue('epoch-spike-dry')],
				['account-tags update', () => probe.putTags('queue', '0'.repeat(32), { a: 'b' }, 'v1:dry')],
				['account-tags delete', () => probe.deleteTags('queue', '0'.repeat(32))],
				[
					'policies create',
					() => probe.createPolicy('epoch-spike-dry', [{ email: { email: 'spike@example.com' } }])
				],
				[
					'applications create',
					() =>
						probe.createAccessApp({
							name: 'epoch-spike-dry',
							domain: 'epoch-spike-dry.example.com/login',
							policyIds: [],
							idpIds: [],
							isAutoRedirect: false
						})
				]
			];
			for (const [label, attempt] of attempts) {
				state.lastResult = null;
				try {
					await attempt();
				} catch (error) {
					// A dry run prints a preview, not the resource, so a parse complaint is fine; a non-zero exit is not.
					if (state.lastResult && (state.lastResult as ExecResult).exitCode !== 0)
						failures.push(`${label}: ${(error as Error).message}`);
					else if (!state.lastResult) failures.push(`${label}: ${(error as Error).message}`);
				}
			}
			if (failures.length > 0) throw new Error(failures.join(' | '));
			return 'all seven accepted';
		}
	},
	{
		id: 'tag-scopes-list',
		claim:
			'A profile created with only BASE_SCOPES (which now include tag.read and tag.write) can list tagged resources',
		async run(ctx) {
			const identity = await ctx.cf.whoami();
			const missing = TAG_SCOPES.filter((scope) => !identity.scopes?.includes(scope));
			if (identity.scopes !== null && missing.length > 0)
				throw new Skip(
					`this profile was signed in without ${missing.join(', ')}; run \`npm run setup -- --force\` and re-run the spike`
				);
			const found = await ctx.cf.listTagged([TAG_KEYS.instance]);
			return `listed ${found.length} resource(s) with ${TAG_KEYS.instance}`;
		}
	},
	{
		id: 'worker-script-id',
		claim:
			'GET /accounts/{id}/workers/scripts lists each script with `id` (its name) and `tag` (the 32-hex id the tags API keys on)',
		async run(ctx, state) {
			const id = await ctx.cf.getWorkerScriptId(state.names.worker);
			if (id === null)
				throw new Skip(
					`no Worker ${state.names.worker} with a 32-hex tag in the scripts list (absent, or the field is named differently)`
				);
			return `script id ${id}`;
		}
	},
	{
		id: 'tag-write-etag-412',
		claim:
			'A real write with a stale ETag is refused with 412 (so `cf` sends --if-match and the compare-and-swap works), on a throwaway queue',
		async run(ctx, state) {
			if (!state.accountId) throw new Skip('no account chosen');
			const identity = await ctx.cf.whoami();
			if (identity.scopes !== null && TAG_SCOPES.some((s) => !identity.scopes?.includes(s)))
				throw new Skip('this profile lacks the tag scopes; run `npm run setup -- --force`');
			const name = `epoch-spike-${ctx.now().getTime()}`;
			const queue = await ctx.cf.createQueue(name);
			let hasTags = false;
			const cleanUp = async () => {
				if (hasTags) await ctx.cf.deleteTags('queue', queue.id);
				hasTags = false;
				await ctx.cf.deleteQueue(queue.id);
			};
			// A Ctrl-C mid-check must not leave the queue or its tags behind.
			const forget = ctx.cleanup.add('delete the spike queue and its tags', cleanUp);
			try {
				const first = await ctx.cf.getTags('queue', queue.id);
				await ctx.cf.putTags('queue', queue.id, { [TAG_KEYS.instance]: name }, first.etag);
				hasTags = true;
				try {
					await ctx.cf.putTags('queue', queue.id, { [TAG_KEYS.instance]: `${name}-2` }, first.etag);
				} catch (error) {
					if (error instanceof TagConflictError) return 'the stale ETag was refused with 412';
					throw error;
				}
				throw new Error(
					'the stale-ETag write succeeded: `cf` is not sending --if-match, so tag writes are not compare-and-swap'
				);
			} finally {
				await cleanUp();
				forget();
			}
		}
	},
	{
		id: 'wrangler-profiles',
		claim:
			'`wrangler auth list` exists, and `wrangler whoami --json` agrees with cf on email and account',
		async run(ctx) {
			await ctx.runner.text({ tool: 'wrangler', args: ['auth', 'list'] });
			const identity = await ctx.cf.whoami();
			const wrangler = await ctx.makeWrangler({ kind: 'profile', accountId: '' }).whoami();
			if (
				identity.email &&
				wrangler.email &&
				identity.email.toLowerCase() !== wrangler.email.toLowerCase()
			) {
				throw new Error(`cf is ${identity.email} but wrangler is ${wrangler.email}`);
			}
			return `wrangler is ${wrangler.email ?? 'unknown'}`;
		}
	},
	{
		id: 'wrangler-binding-name',
		claim:
			'`wrangler d1 migrations list DB --remote -c wrangler.deploy.jsonc` accepts the binding name',
		async run(ctx) {
			if (!ctx.fs.exists(ctx.paths.deployConfigFile))
				throw new Skip(
					'no wrangler.deploy.jsonc yet, so the remote half cannot run (the local half, `npm run db:migrate:local` with binding DB, is already verified)'
				);
			await ctx.runner.text({
				tool: 'wrangler',
				args: ['d1', 'migrations', 'list', 'DB', '--remote', '-c', ctx.paths.deployConfigFile]
			});
			return 'remote accepts the binding name (local half already verified)';
		}
	}
];

/** Things only a deploy can settle; listed so the owner knows they remain open after the spike. */
const MANUAL_ITEMS = [
	'Device login: the link/code format `cf auth create` prints (setup lets cf draw its own prompt for now)',
	'Granting fewer scopes on the consent screen: does `cf auth whoami` then show the smaller set?',
	'Does `applications create` return `aud` in its response? (The dry run cannot show it.)',
	'Does a var named CF_ACCESS_AUD deploy over an existing secret of the same name?',
	'Does SvelteKit 3 `$app/env/private` see Worker `vars`?',
	'Does a `send_email` binding naming an unverified sender fail the deploy?',
	'`cf accounts tokens create`: the permission-group ids and body shape for the --deploy-auth=ephemeral token',
	'Does `wrangler deploy` ignore CLOUDFLARE_CF_AUTH (expected: yes)?'
];

export async function runSpike(
	reporter: Reporter,
	isVerbose: boolean,
	nameFlag?: string
): Promise<{ findings: Finding[]; directory: string }> {
	const paths = installPaths();
	mkdirSync(paths.spikeDir, { recursive: true });
	const redactor = createRedactor();
	const real = createExec({
		paths,
		logFile: `${paths.logsDir}/spike-${Date.now()}.log`,
		isVerbose,
		redactor
	});
	const state: SpikeState = {
		accountId: null,
		d1Id: null,
		names: resourceNames(LIVE_INSTALL_NAME),
		lastResult: null
	};
	let sequence = 0;
	const recording: Exec = async (request) => {
		const result = await real(request);
		state.lastResult = result;
		if (!request.hasSecretOutput) {
			sequence += 1;
			const file = `${String(sequence).padStart(2, '0')}-${[request.tool, ...request.args]
				.slice(0, 5)
				.join('-')
				.replace(/[^a-z0-9-]+/gi, '_')}.json`;
			writeFileSync(
				`${paths.spikeDir}/${file}`,
				JSON.stringify(
					{
						tool: request.tool,
						args: request.args,
						exitCode: result.exitCode,
						stdout: result.stdout,
						stderr: redactor.redact(result.stderr)
					},
					null,
					2
				)
			);
		}
		return result;
	};
	const ctx = createContext({
		reporter,
		isVerbose,
		isReadOnly: true,
		exec: recording,
		onRawResponse(path, status, body) {
			sequence += 1;
			const slug = path.replace(/[^a-z0-9]+/gi, '_').slice(0, 60);
			writeFileSync(
				`${paths.spikeDir}/${String(sequence).padStart(2, '0')}-api-${slug}.json`,
				JSON.stringify({ tool: 'api', path, status, body }, null, 2)
			);
		}
	});
	const installed = loadManifest(ctx.fs, ctx.paths.manifestFile);
	state.names = resourceNames(
		nameFlag ?? installed?.workerName ?? readDeployDefaults(ctx).workerName ?? LIVE_INSTALL_NAME
	);
	// The recording exec must be the one the context's runner uses; createContext honours `exec`.
	const findings: Finding[] = [];
	for (const signal of ['SIGINT', 'SIGTERM'] as const) {
		process.once(signal, () => {
			void ctx.cleanup.runAll().finally(() => process.exit(130));
		});
	}
	for (const check of CHECKS) {
		try {
			const detail = await check.run(ctx, state);
			findings.push({ level: FINDING_LEVELS.ok, text: `PASS ${check.id}: ${detail}` });
		} catch (error) {
			if (error instanceof Skip)
				findings.push({ level: FINDING_LEVELS.warn, text: `SKIP ${check.id}: ${error.message}` });
			else
				findings.push({
					level: FINDING_LEVELS.fail,
					text: `FAIL ${check.id}: ${(error as Error).message}\n  assumed: ${check.claim}`
				});
		}
	}
	for (const item of MANUAL_ITEMS)
		findings.push({ level: FINDING_LEVELS.warn, text: `MANUAL ${item}` });
	// Kept on disk so nothing is lost when the terminal closes.
	writeFileSync(`${paths.spikeDir}/summary.txt`, `${findings.map((f) => f.text).join('\n')}\n`);
	return { findings, directory: paths.spikeDir };
}
