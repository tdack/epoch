import { describe, expect, it } from 'vitest';
import type { Asker } from './asker.ts';
import type { CloudflareApi, Identity } from './cloudflare.ts';
import { parseDeployDefaults } from './deploy-config.ts';
import { DEFAULT_FLAGS, type Answers, type SetupFlags } from './options.ts';
import { RESOURCE_STATES, reconcile, type Observed } from './reconcile.ts';
import { resourceNames } from './names.ts';
import { collect } from './steps/collect.ts';
import { buildPlan } from './steps/plan.ts';
import { verify } from './steps/verify.ts';
import { NO_ASKER, fixture, stubApi, testContext, testManifest } from './testing.ts';

const YES = { isYes: true, isInteractive: false };
const TTY = { isYes: false, isInteractive: true };
const identity: Identity = {
	email: 'a@example.com',
	userId: null,
	accountIds: ['acc'],
	scopes: []
};
const policies = (fixture('access-policies.json') as any[]).map((p) => ({ ...p, appNames: [] }));
const flags = (over: Partial<SetupFlags> = {}): SetupFlags => ({
	...DEFAULT_FLAGS,
	hosting: 'workers-dev',
	...over
});
const CURRENT = 'welcome@epoch.example.com';
const defaults = { ...parseDeployDefaults(null), emailSender: CURRENT as string | null };

function api(over: Partial<CloudflareApi> = {}) {
	return stubApi({
		listAccounts: async () => [{ id: 'acc', name: 'A' }],
		getWorkersSubdomain: async () => 'me',
		listActiveZones: async () => [{ id: 'z1', name: 'example.com' }],
		getTeamDomain: async () => 't',
		listIdentityProviders: async () => [{ id: 'i', name: 'n', type: 't' }],
		listPolicies: async () => policies,
		listAccessApps: async () => [],
		listEmailSenderDomains: async () => [{ domain: 'epoch.example.com', isVerified: true }],
		...over
	});
}
const run = (
	cf: CloudflareApi,
	f: Partial<SetupFlags>,
	mode = YES,
	asker: Asker = NO_ASKER as Asker,
	d = defaults
) =>
	collect(
		testContext({ cf }).ctx,
		testManifest({ workerName: 'shop' }),
		flags(f),
		identity,
		mode,
		asker,
		d
	);

describe('the invitation sender', () => {
	it('is read from an existing deploy config', () => {
		const text = JSON.stringify({
			send_email: [{ name: 'EMAIL', allowed_sender_addresses: [CURRENT] }]
		});
		expect(parseDeployDefaults(text).emailSender).toBe(CURRENT);
		expect(parseDeployDefaults('{}').emailSender).toBeNull();
	});

	it('workers.dev hosting keeps an existing sender: where the Worker is served does not matter', async () => {
		const { answers } = await run(api(), {});
		expect(answers).toMatchObject({
			hosting: 'workers-dev',
			emailSender: CURRENT,
			removedEmailSender: null
		});
	});

	it('an unreadable Email Sending status keeps it, and says so', async () => {
		const { ctx, report } = testContext({
			cf: api({ listEmailSenderDomains: async () => Promise.reject(new Error('403')) })
		});
		const { answers } = await collect(
			ctx,
			testManifest({ workerName: 'shop' }),
			flags(),
			identity,
			TTY,
			{
				...NO_ASKER,
				text: async () => 'a@example.com',
				multiselect: async (o: any) => (o.initial.length ? o.initial : ['__new__']),
				select: async () => null
			} as Asker,
			defaults
		);
		expect(answers.emailSender).toBe(CURRENT);
		expect(report.warnings.join('\n')).toContain('keeping the existing sender');
	});

	it('looks at every zone, not just a hosting zone', async () => {
		const seen: string[] = [];
		const cf = api({
			listActiveZones: async () => [
				{ id: 'z1', name: 'a.com' },
				{ id: 'z2', name: 'b.com' }
			],
			listEmailSenderDomains: async (zoneId) => (seen.push(zoneId), [])
		});
		await run(cf, {}, YES, NO_ASKER as Asker, { ...defaults, emailSender: null });
		expect(seen).toEqual(['z1', 'z2']);
	});

	it('on a terminal the current sender is first, labelled (current), and the default', async () => {
		let asked: any;
		const asker = {
			...NO_ASKER,
			text: async () => 'a@example.com',
			multiselect: async (o: any) => (o.initial.length ? o.initial : ['__new__']),
			select: async (o: any) =>
				o.message.includes('invitations') ? ((asked = o), o.initial) : null
		} as Asker;
		const { answers } = await run(api(), {}, TTY, asker);
		expect(asked.choices[0].label).toBe(`${CURRENT} (current)`);
		expect(asked.initial).toBe(CURRENT);
		expect(answers.emailSender).toBe(CURRENT);
	});

	it('choosing "no email" removes it, and the removal is recorded for the plan', async () => {
		const asker = {
			...NO_ASKER,
			text: async () => 'a@example.com',
			multiselect: async (o: any) => (o.initial.length ? o.initial : ['__new__']),
			select: async (o: any) => (o.message.includes('invitations') ? null : null)
		} as Asker;
		const { answers } = await run(api(), {}, TTY, asker);
		expect(answers).toMatchObject({ emailSender: null, removedEmailSender: CURRENT });
	});

	it('--no-email-sender removes it explicitly, even under --yes', async () => {
		const { answers } = await run(api(), { isEmailSenderRemoved: true });
		expect(answers).toMatchObject({ emailSender: null, removedEmailSender: CURRENT });
	});

	it('--email-sender overrides', async () => {
		expect((await run(api(), { emailSender: 'x@y.co' })).answers.emailSender).toBe('x@y.co');
	});

	it('the plan shows a removal so the confirm covers it, and a kept sender as unchanged', () => {
		const names = resourceNames('shop');
		const observed: Observed = {
			d1: null,
			r2: null,
			worker: null,
			queue: null,
			accessApp: null,
			accessPolicy: null
		};
		const result = reconcile({ manifest: null, names, hostname: 'h', observed });
		const base = {
			workerName: 'shop',
			hosting: 'workers-dev',
			hostname: 'shop.me.workers.dev',
			isWorkersDevKept: false,
			policy: { existingIds: [], isNewPolicy: true },
			ownerEmail: 'a@b.co',
			zone: null,
			d1Location: null,
			r2Location: null,
			r2Jurisdiction: null
		} as unknown as Answers;
		const removed = buildPlan(
			testManifest({ workerName: 'shop' }),
			{ ...base, emailSender: null, removedEmailSender: CURRENT } as Answers,
			result,
			[]
		);
		expect(removed.find((l) => l.text.includes('send_email'))).toEqual({
			symbol: '-',
			text: `send_email: remove ${CURRENT} (invitations will not be emailed)`
		});
		const kept = buildPlan(
			testManifest({ workerName: 'shop' }),
			{ ...base, emailSender: CURRENT, removedEmailSender: null } as Answers,
			result,
			[]
		);
		expect(kept.find((l) => l.text.includes('send_email'))?.symbol).toBe('=');
		expect(RESOURCE_STATES.absent).toBe('absent');
	});
});

describe('verify, with the public tree (ADR-041)', () => {
	const live = testManifest({
		hostname: 'epoch.example.com',
		teamDomain: 'team.cloudflareaccess.com',
		access: { app: { id: 'a', name: 'n', aud: 'aud' }, policies: [], idps: [] }
	});
	function site(trees: Response, write: Response): typeof fetch {
		return (async (input: string | URL | Request, init?: RequestInit) => {
			const path = new URL(String(input)).pathname;
			if (path === '/api/trees') return (init?.method ?? 'GET') === 'POST' ? write : trees;
			if (path === '/')
				return new Response('', { status: 303, headers: { location: '/welcome?next=/' } });
			if (path === '/login')
				return new Response('', {
					status: 302,
					headers: { location: 'https://team.cloudflareaccess.com/x' }
				});
			return new Response('', { status: 200 });
		}) as typeof fetch;
	}
	const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
	async function checks(trees: Response, write: Response = new Response('', { status: 401 })) {
		const { ctx } = testContext({
			fetch: site(trees, write),
			cf: stubApi({ readWorkerVar: async () => 'aud' })
		});
		const { results } = await verify(ctx, live);
		return {
			read: results.find((r) => r.name.startsWith('Anonymous GET'))!,
			write: results.find((r) => r.name.startsWith('Anonymous POST'))!
		};
	}

	it('passes on no public tree, naming nothing', async () => {
		const { read } = await checks(json({ trees: [] }));
		expect(read.status).toBe('pass');
		expect(read.detail).toContain('no public tree');
	});

	it('passes on one viewer tree and names it', async () => {
		const { read } = await checks(
			json({ trees: [{ id: 't', name: 'The Simpsons', role: 'viewer' }] })
		);
		expect(read.status).toBe('pass');
		expect(read.detail).toContain('The Simpsons');
	});

	it('passes on 401 from a Worker built before the public tree, and says so', async () => {
		const { read } = await checks(new Response('', { status: 401 }));
		expect(read.status).toBe('pass');
		expect(read.detail).toContain('before the public tree');
	});

	it.each([
		['two trees', json({ trees: [{ role: 'viewer' }, { role: 'viewer' }] })],
		['a non-viewer role', json({ trees: [{ name: 'x', role: 'editor' }] })],
		['a server error', new Response('', { status: 500 })],
		['no trees list', json({ nope: 1 })]
	])('fails on %s, with a privacy hint', async (_label, response) => {
		const { read } = await checks(response);
		expect(read.status).toBe('fail');
		expect(read.fix).toContain('privacy leak');
	});

	it('refuses anonymous writes with 401, 400 or 403 and fails only on a 2xx', async () => {
		for (const status of [401, 400, 403])
			expect((await checks(json({ trees: [] }), new Response('', { status }))).write.status).toBe(
				'pass'
			);
		const bad = await checks(json({ trees: [] }), new Response('{}', { status: 201 }));
		expect(bad.write.status).toBe('fail');
		expect(bad.write.fix).toContain('anyone can create trees');
	});
});
