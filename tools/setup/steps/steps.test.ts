import { describe, expect, it } from 'vitest';
import type { Asker } from '../asker.ts';
import type { CloudflareApi, Identity } from '../cloudflare.ts';
import { ERROR_CODES, SetupError } from '../errors.ts';
import { runSetup, type Presenter } from '../flow.ts';
import { AUTH_MODES, OWNERSHIPS, newManifest } from '../manifest.ts';
import { DEFAULT_FLAGS, type Answers, type SetupFlags } from '../options.ts';
import { requestedScopes } from '../scopes.ts';
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
import { access } from './access.ts';
import { collect } from './collect.ts';
import { migrateMarkDeploy } from './migrate-mark-deploy.ts';
import { confirmAdoptions } from './plan.ts';
import { detectEnvToken, preflight } from './preflight.ts';
import { provision } from './provision.ts';
import { assertSameIdentity, signIn } from './sign-in.ts';
import { verify } from './verify.ts';
import { isExportOnlyRule, type R2LifecycleRule } from '../lifecycle.ts';
import { RESOURCE_STATES, reconcile, type Observed } from '../reconcile.ts';
import { resourceNames } from '../names.ts';

const YES = { isYes: true, isInteractive: false };
const NO_TTY = { isYes: false, isInteractive: false };
const TTY = { isYes: false, isInteractive: true };
const flags = (over: Partial<SetupFlags> = {}): SetupFlags => ({ ...DEFAULT_FLAGS, ...over });

async function failure(work: () => unknown): Promise<SetupError> {
	try {
		await work();
	} catch (error) {
		return error as SetupError;
	}
	throw new Error('did not throw');
}

describe('preflight', () => {
	it('stops on an old Node, and names the fix', async () => {
		const { ctx } = testContext({ nodeVersion: '22.1.0' });
		expect((await failure(() => preflight(ctx, flags()))).message).toContain('Node 24');
	});

	it('detects CLOUDFLARE_API_TOKEN in the shell and in .env, ignoring an empty one', () => {
		expect(detectEnvToken({ CLOUDFLARE_API_TOKEN: 'x' }, null)).toBe('shell');
		expect(detectEnvToken({}, '# c\nCLOUDFLARE_API_TOKEN=abc\n')).toBe('.env');
		expect(detectEnvToken({}, 'export CLOUDFLARE_API_TOKEN="abc"')).toBe('.env');
		expect(detectEnvToken({}, 'CLOUDFLARE_API_TOKEN=\nOTHER=1')).toBeNull();
		expect(detectEnvToken({}, null)).toBeNull();
	});

	it('refuses an environment token unless --api-token-env was given, because profiles cannot be made', async () => {
		const { ctx } = testContext({ env: { CLOUDFLARE_API_TOKEN: 'tok' } });
		const error = await failure(() => preflight(ctx, flags()));
		expect(error.code).toBe(ERROR_CODES.environmentToken);
		expect(error.hint).toContain('--api-token-env');
	});

	it('also finds a token that only exists in .env', async () => {
		const fs = memoryFs({ ...baseFiles(), [`${TEST_ROOT}/.env`]: 'CLOUDFLARE_API_TOKEN=abc' });
		expect((await failure(() => preflight(testContext({ fs }).ctx, flags()))).code).toBe(
			ERROR_CODES.environmentToken
		);
	});

	it('runs in env-token mode with --api-token-env, and refuses the flag when no token is set', () => {
		const withToken = testContext({ env: { CLOUDFLARE_API_TOKEN: 'tok' } });
		expect(preflight(withToken.ctx, flags({ isApiTokenEnv: true })).manifest.authMode).toBe(
			AUTH_MODES.envToken
		);
		expect(() => preflight(testContext().ctx, flags({ isApiTokenEnv: true }))).toThrow('not set');
	});

	it('uses the existing install’s workerName and refuses a different one: one checkout is one install', async () => {
		const existing = JSON.stringify({
			...newManifest('family'),
			resources: { d1: { id: 'x', name: 'family-db' }, r2: null, queue: null, worker: null }
		});
		const fs = memoryFs({ ...baseFiles(), [`${TEST_ROOT}/.epoch/install.json`]: existing });
		const { ctx } = testContext({ fs });
		expect(preflight(ctx, flags()).manifest.workerName).toBe('family');
		expect((await failure(() => preflight(ctx, flags({ name: 'other' })))).message).toContain(
			'one checkout is one install'
		);
	});

	it('refuses --deploy-auth=ephemeral, which cannot work until cf can read Workers', async () => {
		const error = await failure(() =>
			preflight(testContext().ctx, flags({ deployAuth: 'ephemeral' }))
		);
		expect(error.flag).toBe('--deploy-auth');
		expect(error.message).toContain('not available yet');
	});

	it('rejects a workerName that cannot name a resource', async () => {
		expect(
			(await failure(() => preflight(testContext().ctx, flags({ name: 'Bad Slug!' })))).flag
		).toBe('--name');
	});
});

describe('sign in', () => {
	const identity = (over: Partial<Identity> = {}): Identity => ({
		email: 'o@example.com',
		userId: 'u',
		accountIds: ['acc'],
		scopes: requestedScopes(AUTH_MODES.profile),
		...over
	});

	it('stops before touching anything when a requested scope was not granted, naming the re-run', async () => {
		const scopes = requestedScopes(AUTH_MODES.profile).filter((s) => s !== 'access-app.write');
		const { ctx } = testContext({ cf: stubApi({ whoami: async () => identity({ scopes }) }) });
		const error = await failure(() => signIn(ctx, testManifest(), flags()));
		expect(error.code).toBe(ERROR_CODES.scopesMissing);
		expect(error.message).toContain('access-app.write');
		expect(error.hint).toContain('--force');
	});

	it('warns, rather than guessing, when cf does not report scopes', async () => {
		const { ctx, report } = testContext({
			cf: stubApi({ whoami: async () => identity({ scopes: null }) }),
			wrangler: { whoami: async () => ({ email: 'o@example.com', accountIds: ['acc'] }) }
		});
		await signIn(ctx, testManifest(), flags());
		expect(report.warnings[0]).toContain('cannot be checked');
	});

	it('asks only for the broad token-minting scope with --deploy-auth=ephemeral', () => {
		expect(requestedScopes(AUTH_MODES.profile)).not.toContain('account_api_tokens:create');
		expect(requestedScopes(AUTH_MODES.ephemeral)).toContain('account_api_tokens:create');
	});

	it('signs in with a profile bound to the repository root, not to tools/setup', async () => {
		let calls = 0;
		const exec = fakeExec([{ match: 'cf auth', stdout: '' }]);
		const { ctx } = testContext({
			exec,
			cf: stubApi({
				whoami: async () =>
					calls++ === 0 ? Promise.reject(new Error('not signed in')) : identity()
			}),
			wrangler: { whoami: async () => ({ email: 'o@example.com', accountIds: ['acc'] }) }
		});
		await signIn(ctx, testManifest(), flags({ isBrowser: false, isDevice: false }));
		const create = exec.calls.find((c) => c.args[1] === 'create')!;
		expect(create.args).toContain('--no-browser');
		expect(create.args).toContain('--no-device');
		expect(create.isInteractive).toBe(true);
		expect(exec.calls.find((c) => c.args[1] === 'activate')!.args.at(-1)).toBe(TEST_ROOT);
	});

	it('stops when cf and wrangler are signed in as different people', () => {
		expect(() =>
			assertSameIdentity(identity(), { email: 'someone@else.com', accountIds: ['acc'] })
		).toThrow('cf is signed in as o@example.com but wrangler as someone@else.com');
		expect(() =>
			assertSameIdentity(identity(), { email: 'o@example.com', accountIds: ['other'] })
		).toThrow(SetupError);
		expect(() =>
			assertSameIdentity(identity(), { email: 'O@Example.com', accountIds: ['acc'] })
		).not.toThrow();
	});
});

describe('collect', () => {
	const policies = (fixture('access-policies.json') as any[]).map((p) => ({ ...p, appNames: [] }));
	function api(over: Partial<CloudflareApi> = {}) {
		return stubApi({
			listAccounts: async () => [{ id: 'acc', name: 'Account' }],
			listActiveZones: async () => [{ id: 'zone1', name: 'example.com' }],
			getTeamDomain: async () => 'team.cloudflareaccess.com',
			getWorkersSubdomain: async () => 'me',
			listIdentityProviders: async () => [{ id: 'idp1', name: 'OTP', type: 'onetimepin' }],
			findHostnameUse: async () => null,
			listPolicies: async () => policies,
			listAccessApps: async () => [],
			listEmailSenderDomains: async () => [],
			...over
		});
	}
	const identity: Identity = {
		email: 'a@example.com',
		userId: 'u',
		accountIds: ['acc'],
		scopes: []
	};

	it('--yes accepts the discovered defaults: one account, one zone, <name>.<zone>, an existing policy that admits the owner', async () => {
		const { ctx } = testContext({ cf: api() });
		const { answers } = await collect(
			ctx,
			testManifest(),
			flags({ isYes: true }),
			identity,
			YES,
			NO_ASKER as Asker
		);
		expect(answers).toMatchObject({
			hostname: 'epoch.example.com',
			ownerEmail: 'a@example.com',
			idpIds: ['idp1'],
			d1Location: null,
			emailSender: null
		});
		expect(answers.policy).toEqual({ existingIds: [policies[0].id], isNewPolicy: false });
	});

	it('without a terminal and without --yes, a question with several answers is an error naming the flag', async () => {
		const { ctx } = testContext({
			cf: api({
				listActiveZones: async () => [
					{ id: 'z1', name: 'a.com' },
					{ id: 'z2', name: 'b.com' }
				]
			})
		});
		const error = await failure(() =>
			collect(
				ctx,
				testManifest(),
				flags({ hosting: 'custom' }),
				identity,
				NO_TTY,
				NO_ASKER as Asker
			)
		);
		expect(error.code).toBe(ERROR_CODES.missingAnswer);
		expect(error.flag).toBe('--zone');
	});

	it('--yes still cannot choose between two zones', async () => {
		const { ctx } = testContext({
			cf: api({
				listActiveZones: async () => [
					{ id: 'z1', name: 'a.com' },
					{ id: 'z2', name: 'b.com' }
				]
			})
		});
		expect(
			(
				await failure(() =>
					collect(ctx, testManifest(), flags({ isYes: true }), identity, YES, NO_ASKER as Asker)
				)
			).flag
		).toBe('--zone');
	});

	it.each([
		[
			'no hosting at all',
			{ listActiveZones: async () => [], getWorkersSubdomain: async () => null },
			'nowhere to serve'
		],
		[
			'no Zero Trust organisation',
			{ getTeamDomain: async () => null },
			'no Zero Trust organisation'
		],
		['no identity provider', { listIdentityProviders: async () => [] }, 'no identity provider']
	])(
		'stops with a prerequisite message for %s, and never tries to create it',
		async (_name, over, text) => {
			const { ctx } = testContext({ cf: api(over as Partial<CloudflareApi>) });
			const error = await failure(() =>
				collect(ctx, testManifest(), flags({ isYes: true }), identity, YES, NO_ASKER as Asker)
			);
			expect(error.code).toBe(ERROR_CODES.prerequisite);
			expect(error.message).toContain(text);
		}
	);

	it('refuses a hostname another Worker or a DNS record already serves', async () => {
		const { ctx } = testContext({
			cf: api({ findHostnameUse: async () => 'a DNS record for epoch.example.com already exists' })
		});
		expect(
			(
				await failure(() =>
					collect(ctx, testManifest(), flags({ isYes: true }), identity, YES, NO_ASKER as Asker)
				)
			).message
		).toContain('DNS record');
	});

	it('refuses chosen policies that do not admit the owner, and a Block policy', async () => {
		const { ctx } = testContext({ cf: api() });
		const wrong = await failure(() =>
			collect(
				ctx,
				testManifest(),
				flags({ policy: [policies[0].id], ownerEmail: 'zed@example.org' }),
				identity,
				YES,
				NO_ASKER as Asker
			)
		);
		expect(wrong.message).toContain('do not admit zed@example.org');
		const bypass = await failure(() =>
			collect(
				ctx,
				testManifest(),
				flags({ policy: [policies[2].id] }),
				identity,
				YES,
				NO_ASKER as Asker
			)
		);
		expect(bypass.message).toContain('not an Allow policy');
	});

	it('warns about an everyone policy and refuses --policy together with --new-policy', async () => {
		const { ctx, report } = testContext({ cf: api() });
		await collect(
			ctx,
			testManifest(),
			flags({ policy: [policies[1].id] }),
			identity,
			YES,
			NO_ASKER as Asker
		);
		expect(report.warnings[0]).toContain('admits everyone');
		expect(
			(
				await failure(() =>
					collect(
						ctx,
						testManifest(),
						flags({ policy: ['x'], isNewPolicy: true }),
						identity,
						YES,
						NO_ASKER as Asker
					)
				)
			).flag
		).toBe('--policy');
	});
});

describe('typed adoption', () => {
	const names = resourceNames('epoch');
	const observed: Observed = {
		d1: {
			id: 'd1',
			name: names.d1,
			createdAt: null,
			markerInstallId: null,
			migrationsApplied: 1,
			migrationsExpected: 1,
			trees: 1,
			people: 1,
			users: 1,
			ownerEmails: [],
			sizeBytes: 1
		},
		r2: null,
		worker: null,
		queue: null,
		accessApp: null,
		accessPolicy: null
	};
	const result = reconcile({ manifest: null, names, hostname: 'h', observed });
	const answers = { typedAdoptions: {} } as Answers;

	it('--yes refuses to adopt an unmarked resource', async () => {
		const error = await failure(() =>
			confirmAdoptions(result, answers, YES, NO_ASKER as Asker, testContext().report)
		);
		expect(error.code).toBe(ERROR_CODES.needsTypedConfirmation);
	});

	it('shows the fingerprint, then accepts only the typed name', async () => {
		const { report } = testContext();
		const asker = { ...NO_ASKER, text: async () => names.d1 } as Asker;
		const done = await confirmAdoptions(result, answers, TTY, asker, report);
		expect(done.typedAdoptions.d1).toBe(names.d1);
		expect(report.infos[0]).toContain('carries no marker');
		expect(report.infos[0]).toContain('trees: 1');
	});

	it('needs nothing when everything is absent', async () => {
		const empty = reconcile({
			manifest: null,
			names,
			hostname: 'h',
			observed: { ...observed, d1: null }
		});
		expect(empty.reports.d1.state).toBe(RESOURCE_STATES.absent);
		expect(
			(await confirmAdoptions(empty, answers, YES, NO_ASKER as Asker, testContext().report))
				.typedAdoptions
		).toEqual({});
	});
});

describe('access', () => {
	const policies = (fixture('access-policies.json') as any[]).map((p) => ({ ...p, appNames: [] }));
	const base = {
		workerName: 'epoch',
		hostname: 'epoch.example.com',
		ownerEmail: 'a@example.com',
		idpIds: ['idp1']
	} as Answers;

	it('attaches existing policies as they are: it never calls update on them', async () => {
		const calls: string[] = [];
		const { ctx } = testContext({
			cf: stubApi({
				listPolicies: async () => policies,
				createAccessApp: async (body) => {
					calls.push(
						`app ${body.domain} ${body.policyIds.join(',')} redirect=${body.isAutoRedirect}`
					);
					return {
						id: 'app1',
						name: body.name,
						domain: body.domain,
						aud: 'aud1',
						policyIds: body.policyIds,
						isPathCookieAttributeOn: false,
						isBindingCookieOn: false
					};
				}
			})
		});
		const next = await access(ctx, testManifest(), {
			...base,
			policy: { existingIds: [policies[0].id], isNewPolicy: false }
		});
		expect(calls).toEqual([`app epoch.example.com/login ${policies[0].id} redirect=true`]);
		expect(next.access.policies).toEqual([
			{ id: policies[0].id, name: 'Family', ownership: OWNERSHIPS.referenced }
		]);
		expect(next.access.app?.aud).toBe('aud1');
	});

	it('creates the owner-only policy as owned, and updates the application by id on a re-run', async () => {
		const updated: string[] = [];
		const { ctx } = testContext({
			cf: stubApi({
				listPolicies: async () => [],
				createPolicy: async (name, include) => {
					expect(include).toEqual([{ email: { email: 'a@example.com' } }]);
					return {
						id: 'newpol',
						name,
						decision: 'allow',
						include,
						exclude: [],
						require: [],
						appNames: []
					};
				},
				updateAccessApp: async (id, body) => {
					updated.push(id);
					return {
						id,
						name: body.name,
						domain: body.domain,
						aud: 'aud1',
						policyIds: body.policyIds,
						isPathCookieAttributeOn: false,
						isBindingCookieOn: false
					};
				}
			})
		});
		const manifest = testManifest({
			access: {
				app: { id: 'app-existing', name: 'Epoch (epoch)', aud: 'aud1' },
				policies: [],
				idps: []
			}
		});
		const next = await access(ctx, manifest, {
			...base,
			policy: { existingIds: [], isNewPolicy: true }
		});
		expect(updated).toEqual(['app-existing']);
		expect(next.access.policies).toEqual([
			{ id: 'newpol', name: 'Epoch epoch sign-in', ownership: OWNERSHIPS.owned }
		]);
	});

	it('treats a same-named policy it did not create as referenced, so allow/disallow stay refused', async () => {
		const clash = { ...policies[0], id: 'clash', name: 'Epoch epoch sign-in' };
		const { ctx } = testContext({
			cf: stubApi({
				listPolicies: async () => [clash],
				createAccessApp: async (body) => ({
					id: 'a',
					name: body.name,
					domain: body.domain,
					aud: 'aud',
					policyIds: body.policyIds,
					isPathCookieAttributeOn: false,
					isBindingCookieOn: false
				})
			})
		});
		const next = await access(ctx, testManifest(), {
			...base,
			policy: { existingIds: [], isNewPolicy: true }
		});
		expect(next.access.policies[0]?.ownership).toBe(OWNERSHIPS.referenced);
	});

	it('sends the cookie settings ADR-026 needs off, and no auto-redirect with two providers', async () => {
		const exec = fakeExec([
			{ match: 'cf zero-trust access policies list', stdout: [] },
			{
				match: 'cf zero-trust access policies create',
				stdout: { id: 'p', name: 'Epoch epoch sign-in', decision: 'allow', include: [] }
			},
			{
				match: 'cf zero-trust access applications create',
				stdout: {
					id: 'a9a9a9a9-0000-4000-8000-000000000001',
					name: 'Epoch (epoch)',
					domain: 'epoch.example.com/login',
					aud: 'aud'
				}
			},
			{ match: 'cf account-tags get', stdout: fixture('tags-get-untagged.json') },
			{ match: 'cf account-tags update', stdout: {} }
		]);
		const { ctx } = testContext({ exec });
		ctx.cf.useAccount('acc');
		await access(ctx, testManifest(), {
			...base,
			idpIds: ['i1', 'i2'],
			policy: { existingIds: [], isNewPolicy: true }
		});
		const create = exec.calls.find(
			(c) => c.args.slice(0, 4).join(' ') === 'zero-trust access applications create'
		)!;
		const body = JSON.parse(create.args[create.args.indexOf('--body') + 1]!);
		expect(body).toMatchObject({
			type: 'self_hosted',
			domain: 'epoch.example.com/login',
			path_cookie_attribute: false,
			enable_binding_cookie: false,
			auto_redirect_to_identity: false,
			allowed_idps: ['i1', 'i2']
		});
	});

	it('fails clearly when the response carries no AUD', async () => {
		const { ctx } = testContext({
			cf: stubApi({
				listPolicies: async () => policies,
				createAccessApp: async (b) => ({
					id: 'a',
					name: b.name,
					domain: b.domain,
					aud: '',
					policyIds: [],
					isPathCookieAttributeOn: false,
					isBindingCookieOn: false
				})
			})
		});
		expect(
			(
				await failure(() =>
					access(ctx, testManifest(), {
						...base,
						policy: { existingIds: [policies[0].id], isNewPolicy: false }
					})
				)
			).message
		).toContain('no AUD');
	});
});

describe('migrate, mark, deploy', () => {
	const manifest = (over = {}) =>
		testManifest({
			authMode: AUTH_MODES.ephemeral,
			account: { id: 'acc', name: 'A' },
			ownerEmail: 'a@example.com',
			resources: {
				d1: { id: 'd1d10000-0000-4000-8000-000000000001', name: 'epoch-db' },
				r2: { name: 'epoch-media' },
				queue: null,
				worker: null
			},
			...over
		});

	it('deletes the minted token even when the deploy fails, and never writes it to argv', async () => {
		const deleted: string[] = [];
		const steps: string[] = [];
		const { ctx } = testContext({
			cf: stubApi({
				listTokens: async () => [
					{ id: 'stale', name: 'epoch-epoch-setup-1' },
					{ id: 'unrelated', name: 'my-own-token' }
				],
				deleteToken: async (id) => {
					deleted.push(id);
				},
				mintDeployToken: async () => ({ id: 'minted', value: 'cfut_secretsecretsecret' }),
				queryD1: async () => [
					{
						install_id: '11111111-1111-4111-8111-111111111111',
						owner_email: 'a@example.com',
						created_at: 1
					}
				]
			}),
			wrangler: {
				migrate: async () => void steps.push('migrate'),
				putObject: async () => void steps.push('r2 marker'),
				build: async () => void steps.push('build'),
				deploy: async () => {
					throw new Error('deploy exploded');
				}
			}
		});
		await expect(migrateMarkDeploy(ctx, manifest())).rejects.toThrow('deploy exploded');
		expect(steps).toEqual(['migrate', 'r2 marker', 'build']);
		// The stale token from an earlier interrupted run is swept; a token with another name is left alone.
		expect(deleted).toEqual(['stale', 'minted']);
	});

	it('writes the D1 marker after migrating, then the R2 marker, builds and deploys', async () => {
		const order: string[] = [];
		const { ctx } = testContext({
			cf: stubApi({
				queryD1: async (_id, sql) => {
					order.push(sql.split(' ')[0]!);
					return sql.startsWith('SELECT')
						? [
								{
									install_id: '11111111-1111-4111-8111-111111111111',
									owner_email: 'a@example.com',
									created_at: 1
								}
							]
						: [];
				}
			}),
			wrangler: {
				migrate: async () => void order.push('migrate'),
				putObject: async () => void order.push('r2'),
				build: async () => void order.push('build'),
				deploy: async () => void order.push('deploy')
			}
		});
		const next = await migrateMarkDeploy(ctx, manifest({ authMode: AUTH_MODES.profile }));
		expect(order).toEqual(['migrate', 'INSERT', 'UPDATE', 'SELECT', 'r2', 'build', 'deploy']);
		expect(next.markersWritten.sort()).toEqual(['d1', 'r2', 'worker']);
	});

	it('reports a missing install_meta table as a pending marker, not a crash', async () => {
		const { ctx, report } = testContext({
			cf: stubApi({
				queryD1: async () => Promise.reject(new Error('no such table: install_meta'))
			}),
			wrangler: {
				migrate: async () => {},
				putObject: async () => {},
				build: async () => {},
				deploy: async () => {}
			}
		});
		const next = await migrateMarkDeploy(ctx, manifest({ authMode: AUTH_MODES.profile }));
		expect(next.markersWritten).not.toContain('d1');
		expect(report.warnings[0]).toContain('marker is pending');
	});

	it('refuses to mark a database that already holds another install’s marker', async () => {
		const { ctx } = testContext({
			cf: stubApi({
				queryD1: async (_i, sql) =>
					sql.startsWith('SELECT')
						? [
								{
									install_id: '22222222-2222-4222-8222-222222222222',
									owner_email: 'x@y.co',
									created_at: 1
								}
							]
						: []
			}),
			wrangler: {
				migrate: async () => {},
				putObject: async () => {},
				build: async () => {},
				deploy: async () => Promise.reject(new Error('must not deploy'))
			}
		});
		expect(
			(await failure(() => migrateMarkDeploy(ctx, manifest({ authMode: AUTH_MODES.profile })))).code
		).toBe(ERROR_CODES.foreign);
	});
});

describe('verify', () => {
	const live = testManifest({
		hostname: 'epoch.example.com',
		teamDomain: 'team.cloudflareaccess.com',
		access: { app: { id: 'a', name: 'n', aud: 'aud' }, policies: [], idps: [] }
	});
	function site(responses: Record<string, Response | 'down'>): typeof fetch {
		return (async (input: string | URL | Request) => {
			const path = new URL(String(input)).pathname;
			const response = responses[path];
			if (response === 'down' || response === undefined) throw new TypeError('fetch failed');
			return response;
		}) as typeof fetch;
	}
	const good = {
		'/welcome': new Response('', { status: 200 }),
		'/': new Response('', { status: 303, headers: { location: '/welcome?next=/' } }),
		'/login': new Response('', {
			status: 302,
			headers: { location: 'https://team.cloudflareaccess.com/cdn-cgi/access/login' }
		}),
		'/api/trees': new Response('', { status: 401 })
	};

	it('passes a healthy site and marks the step done', async () => {
		const { ctx } = testContext({
			fetch: site(good),
			cf: stubApi({ readWorkerVar: async () => 'aud' })
		});
		const { results, manifest } = await verify(ctx, live);
		expect(results.map((r) => r.status)).toEqual(['pass', 'pass', 'pass', 'pass', 'pass', 'pass']);
		expect(manifest.completedSteps).toContain('verify');
	});

	it('fails with a fix when /login is not behind Access, and does not mark the step done', async () => {
		const bad = { ...good, '/login': new Response('', { status: 200 }) };
		const { ctx } = testContext({
			fetch: site(bad),
			cf: stubApi({ readWorkerVar: async () => 'aud' })
		});
		const { results, manifest } = await verify(ctx, live);
		const login = results.find((r) => r.name.includes('/login'))!;
		expect(login.status).toBe('fail');
		expect(login.fix).toContain('Access application');
		expect(manifest.completedSteps).not.toContain('verify');
	});

	it('polls for the certificate and fails if it never arrives', async () => {
		const { ctx } = testContext({
			fetch: site({ '/welcome': 'down' }),
			cf: stubApi({ readWorkerVar: async () => null })
		});
		const { results } = await verify(ctx, live);
		expect(results[0]).toMatchObject({ name: 'Certificate issued', status: 'fail' });
	});

	it('skips the AUD comparison when the AUD is a secret that cannot be read back', async () => {
		const { ctx } = testContext({ fetch: site(good), cf: stubApi() });
		const { results } = await verify(ctx, { ...live, isAudSecret: true });
		expect(results.at(-1)?.status).toBe('skip');
	});
});

describe('the whole flow', () => {
	const policies = (fixture('access-policies.json') as any[]).map((p) => ({ ...p, appNames: [] }));
	const quiet: Presenter = {
		stage: () => {},
		task: (_label, work) => work(),
		showPlan: () => {},
		showChecks: () => {},
		showHandOff: () => {},
		showExisting: () => {}
	};
	const cf = () =>
		stubApi({
			whoami: async () => ({
				email: 'a@example.com',
				userId: 'u',
				accountIds: ['acc'],
				scopes: requestedScopes(AUTH_MODES.profile)
			}),
			listAccounts: async () => [{ id: 'acc', name: 'Account' }],
			listActiveZones: async () => [{ id: 'zone1', name: 'example.com' }],
			getTeamDomain: async () => 'team.cloudflareaccess.com',
			getWorkersSubdomain: async () => 'me',
			listIdentityProviders: async () => [{ id: 'idp1', name: 'OTP', type: 'onetimepin' }],
			findHostnameUse: async () => null,
			listPolicies: async () => policies,
			listAccessApps: async () => [],
			findD1: async () => null,
			findR2Bucket: async () => null,
			getWorker: async () => null,
			findQueue: async () => null
		});

	it('--plan reconciles and stops: no create call, no deploy, nothing saved as applied', async () => {
		const { ctx } = testContext({
			cf: cf(),
			wrangler: { whoami: async () => ({ email: 'a@example.com', accountIds: ['acc'] }) }
		});
		const result = await runSetup(
			ctx,
			flags({ isPlanOnly: true, isYes: true }),
			YES,
			NO_ASKER as Asker,
			quiet
		);
		expect(result.isApplied).toBe(false);
		expect(result.plan.map((l) => l.symbol).join('')).toContain('+');
		expect(result.plan.some((l) => l.text.includes('create D1 database epoch-db'))).toBe(true);
	});

	it('without --yes or a terminal it refuses to apply, naming --yes', async () => {
		const { ctx } = testContext({
			cf: cf(),
			wrangler: { whoami: async () => ({ email: 'a@example.com', accountIds: ['acc'] }) }
		});
		const error = await failure(() =>
			runSetup(
				ctx,
				flags({
					name: 'epoch',
					hosting: 'custom',
					isKeepWorkersDev: false,
					account: 'acc',
					zone: 'example.com',
					hostname: 'epoch.example.com',
					idp: ['idp1'],
					newPolicy: undefined,
					isNewPolicy: true,
					ownerEmail: 'a@example.com'
				} as any),
				NO_TTY,
				NO_ASKER as Asker,
				quiet
			)
		);
		expect(error.flag).toBe('--yes');
	});
});

describe('provision', () => {
	it('scopes the export lifecycle rule after making the bucket, keeping unrelated rules', async () => {
		const written: R2LifecycleRule[][] = [];
		const created: string[] = [];
		const { ctx } = testContext({
			cf: stubApi({
				createD1: async () => {
					created.push('d1');
					return { id: 'd1', name: 'epoch-db', createdAt: null, sizeBytes: null };
				},
				createR2Bucket: async () => {
					created.push('r2');
					return { name: 'epoch-media', createdAt: null };
				},
				createQueue: async () => {
					created.push('queue');
					return { id: 'q', name: 'epoch-import-queue' };
				},
				getR2Lifecycle: async () => [{ id: 'logs', conditions: { prefix: 'logs/' } }],
				putR2Lifecycle: async (_bucket, rules) => {
					written.push(rules);
				}
			})
		});
		const manifest = await provision(ctx, testManifest(), {
			d1Location: null,
			r2Location: null,
			r2Jurisdiction: null
		} as unknown as Answers);
		expect(created).toEqual(['d1', 'r2', 'queue']);
		expect(manifest.resources.r2).toEqual({ name: 'epoch-media' });
		expect(written).toHaveLength(1);
		expect(written[0]!.some((rule) => isExportOnlyRule(rule))).toBe(true);
		expect(written[0]!.some((rule) => rule.conditions?.prefix === 'logs/')).toBe(true);
	});
});
