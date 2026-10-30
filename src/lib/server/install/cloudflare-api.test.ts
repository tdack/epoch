import { describe, expect, it } from 'vitest';
import { createCloudflareApi, SetupStepError } from './cloudflare-api';

const TOKEN = 'secret-token-value';

interface Seen {
	url: string;
	method: string;
	authorization: string | null;
	body: unknown;
}

/** A fetch that answers from a table keyed by `METHOD path`, recording what it was sent. */
function fakeFetch(routes: Record<string, { status?: number; body: unknown }>) {
	const seen: Seen[] = [];
	const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		const headers = new Headers(init?.headers);
		seen.push({
			url,
			method,
			authorization: headers.get('authorization'),
			body: init?.body ? JSON.parse(String(init.body)) : undefined
		});
		const path = url.replace('https://api.cloudflare.com/client/v4', '');
		const route = routes[`${method} ${path}`];
		if (!route) return new Response(JSON.stringify({ success: false }), { status: 404 });
		return new Response(JSON.stringify(route.body), { status: route.status ?? 200 });
	}) as typeof fetch;
	return { fetchFn, seen };
}

const ok = (result: unknown) => ({ body: { success: true, errors: [], result } });

describe('createCloudflareApi', () => {
	it('sends the token as a bearer header and reads the result', async () => {
		const { fetchFn, seen } = fakeFetch({
			'GET /accounts?per_page=50': ok([{ id: 'acc1', name: 'Family' }])
		});
		const api = createCloudflareApi(TOKEN, fetchFn);
		expect(await api.listAccounts()).toEqual([{ id: 'acc1', name: 'Family' }]);
		expect(seen[0]!.authorization).toBe(`Bearer ${TOKEN}`);
	});

	it('reads a missing subdomain, organisation or Worker as absent, not as a failure', async () => {
		const api = createCloudflareApi(TOKEN, fakeFetch({}).fetchFn);
		expect(await api.getWorkersSubdomain('acc1')).toBeNull();
		expect(await api.getTeamDomain('acc1')).toBeNull();
		expect(await api.hasWorker('acc1', 'epoch')).toBe(false);
	});

	it('lower-cases the subdomain and reads the team domain', async () => {
		const api = createCloudflareApi(
			TOKEN,
			fakeFetch({
				'GET /accounts/acc1/workers/subdomain': ok({ subdomain: 'Dacks' }),
				'GET /accounts/acc1/access/organizations': ok({ auth_domain: 'dacks.cloudflareaccess.com' })
			}).fetchFn
		);
		expect(await api.getWorkersSubdomain('acc1')).toBe('dacks');
		expect(await api.getTeamDomain('acc1')).toBe('dacks.cloudflareaccess.com');
	});

	it('creates an owner-only policy and the app with the same body ./setup sends', async () => {
		const { fetchFn, seen } = fakeFetch({
			'POST /accounts/acc1/access/policies': ok({ id: 'pol1' }),
			'POST /accounts/acc1/access/apps': ok({ id: 'app1', domain: 'x/login', aud: 'aud1' })
		});
		const api = createCloudflareApi(TOKEN, fetchFn);
		expect(await api.createOwnerPolicy('acc1', 'Epoch x sign-in', 'Owner@Example.com')).toEqual({
			id: 'pol1'
		});
		expect(seen[0]!.body).toMatchObject({
			decision: 'allow',
			include: [{ email: { email: 'owner@example.com' } }]
		});
		const app = await api.createApp('acc1', {
			name: 'Epoch (x)',
			domain: 'x/login',
			policyIds: ['pol1'],
			idpIds: ['idp1']
		});
		expect(app).toEqual({ id: 'app1', domain: 'x/login', aud: 'aud1' });
		expect(seen[1]!.body).toMatchObject({
			type: 'self_hosted',
			policies: [{ id: 'pol1', precedence: 1 }],
			allowed_idps: ['idp1'],
			auto_redirect_to_identity: true,
			path_cookie_attribute: false,
			enable_binding_cookie: false
		});
	});

	it('names the step a refused token failed at, and never the token', async () => {
		const api = createCloudflareApi(
			TOKEN,
			fakeFetch({ 'GET /accounts/acc1/access/identity_providers': { status: 403, body: {} } })
				.fetchFn
		);
		const err = await api.listIdentityProviders('acc1').catch((e: unknown) => e);
		expect(err).toBeInstanceOf(SetupStepError);
		expect((err as Error).message).toMatch(/list the Zero Trust login methods/);
		expect((err as Error).message).not.toContain(TOKEN);
	});

	it('tells a token Cloudflare cannot read apart from an API failure', async () => {
		const api = createCloudflareApi(
			TOKEN,
			fakeFetch({
				'GET /accounts?per_page=50': {
					status: 400,
					body: { success: false, errors: [{ code: 6003, message: 'Invalid request headers' }] }
				}
			}).fetchFn
		);
		await expect(api.listAccounts()).rejects.toThrow(/did not recognise the token/);
	});

	it('passes on the API error message for any other failure', async () => {
		const api = createCloudflareApi(
			TOKEN,
			fakeFetch({
				'POST /accounts/acc1/access/apps': {
					status: 400,
					body: { success: false, errors: [{ message: 'domain is invalid' }] }
				}
			}).fetchFn
		);
		await expect(
			api.createApp('acc1', { name: 'a', domain: 'b', policyIds: [], idpIds: [] })
		).rejects.toThrow(/HTTP 400\): domain is invalid/);
	});

	it('says Cloudflare could not be reached when fetch itself fails', async () => {
		const api = createCloudflareApi(TOKEN, (async () => {
			throw new TypeError('network');
		}) as typeof fetch);
		await expect(api.listAccounts()).rejects.toThrow(/Could not reach Cloudflare/);
	});
});
