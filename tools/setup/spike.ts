import { mkdirSync, writeFileSync } from 'node:fs';
import { createContext } from './app.ts';
import { createCloudflareApi } from './cloudflare.ts';
import type { Reporter, StepContext } from './context.ts';
import { FINDING_LEVELS, type Finding } from './doctor.ts';
import { loadManifest } from './manifest.ts';
import { installPaths } from './paths.ts';
import { createExec, createRedactor, type Exec, type ExecResult } from './run.ts';
import { BASE_SCOPES } from './scopes.ts';

/**
 * `npm run setup -- spike`: the plan's step 0, run once by the owner against their own account.
 * Everything is read-only; writes are only ever sent with `--dry-run`. Each raw response is saved
 * under `.epoch/spike/` (git-ignored) so a test fixture can be replaced with the real shape.
 */
interface SpikeState {
	accountId: string | null;
	d1Id: string | null;
	workerName: string | null;
	lastResult: ExecResult | null;
}

interface Check {
	id: string;
	/** The assumption this settles, written the way the code relies on it. */
	claim: string;
	run(ctx: StepContext, state: SpikeState): Promise<string>;
}

class Skip extends Error {}

const CHECKS: Check[] = [
	{
		id: 'whoami-shape',
		claim: '`cf auth whoami --json` reports an email and the granted OAuth scopes',
		async run(ctx) {
			const identity = await ctx.cf.whoami();
			if (identity.scopes === null)
				throw new Error('no scopes reported; setup will warn instead of checking them');
			const missing = BASE_SCOPES.filter((scope) => !identity.scopes?.includes(scope));
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
			const manifest = loadManifest(ctx.fs, ctx.paths.manifestFile);
			const name = manifest?.resources.d1?.name;
			if (!name)
				throw new Skip(
					'no D1 in the manifest; run after an install, or this proves only the list shape'
				);
			const db = await ctx.cf.findD1(name);
			if (!db) throw new Error(`${name} not found`);
			state.d1Id = db.id;
			const rows = await ctx.cf.queryD1(db.id, 'SELECT 1 AS n');
			return `found ${db.id}, SELECT 1 returned ${JSON.stringify(rows)}`;
		}
	},
	{
		id: 'install-meta-readable',
		claim:
			'The install_meta marker reads back through `cf d1 query`; "no such table" maps to marker pending',
		async run(ctx, state) {
			if (!state.d1Id) throw new Skip('no D1 to read');
			try {
				const rows = await ctx.cf.queryD1(
					state.d1Id,
					'SELECT install_id FROM install_meta LIMIT 1'
				);
				return `table exists, ${rows.length} row(s)`;
			} catch (error) {
				if (
					/no such table/i.test(String((error as Error).message)) ||
					/did not print JSON|failed|error/i.test(String((error as Error).message))
				) {
					return `table absent or unreadable (${(error as Error).message}); the code treats this as marker pending`;
				}
				throw error;
			}
		}
	},
	{
		id: 'r2-queues-workers',
		claim: 'r2 buckets, queues and Worker settings list in the shapes the reconcile observers read',
		async run(ctx) {
			const manifest = loadManifest(ctx.fs, ctx.paths.manifestFile);
			const parts: string[] = [];
			parts.push(
				`r2 ${(await ctx.cf.findR2Bucket(manifest?.resources.r2?.name ?? 'epoch-spike-none')) ? 'found' : 'not found (list parsed)'}`
			);
			parts.push(
				`queue ${(await ctx.cf.findQueue(manifest?.resources.queue?.name ?? 'epoch-spike-none')) ? 'found' : 'not found (list parsed)'}`
			);
			const worker = await ctx.cf.getWorker(manifest?.resources.worker?.name ?? 'epoch-spike-none');
			parts.push(
				worker
					? `worker bindings d1=${worker.boundD1Id ?? 'none'} marker=${worker.markerInstallId ?? 'none'}`
					: 'worker not found'
			);
			return parts.join('; ');
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
		claim: 'An Email Sending domains command exists and reports verification',
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
			return 'all five accepted';
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
				throw new Skip('no wrangler.deploy.jsonc yet; run a real setup first');
			await ctx.runner.text({
				tool: 'wrangler',
				args: ['d1', 'migrations', 'list', 'DB', '--remote', '-c', ctx.paths.deployConfigFile]
			});
			return 'accepted';
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
	isVerbose: boolean
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
	const state: SpikeState = { accountId: null, d1Id: null, workerName: null, lastResult: null };
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
	const ctx = createContext({ reporter, isVerbose, isReadOnly: true, exec: recording });
	// The recording exec must be the one the context's runner uses; createContext honours `exec`.
	const findings: Finding[] = [];
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
	return { findings, directory: paths.spikeDir };
}
