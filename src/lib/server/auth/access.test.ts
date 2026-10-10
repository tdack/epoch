import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateAccessJwt, extractAccessJwt, isDevBypassEnabled, isLocalHostname } from './access';
import { hasMinimumRole } from '../../shared/roles';
import { isActionAllowed } from './authorization';

function createMockJwt(
	payload: Record<string, unknown>,
	header: Record<string, unknown> = { alg: 'none', typ: 'JWT' }
): string {
	const b64Url = (obj: unknown) =>
		btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
	return `${b64Url(header)}.${b64Url(payload)}.mockSignature`;
}

describe('Cloudflare Access JWT & Authorization', () => {
	it('extracts token from cf-access-jwt-assertion header', () => {
		const req = new Request('https://epoch.example.com', {
			headers: { 'cf-access-jwt-assertion': 'sample-jwt-token' }
		});
		expect(extractAccessJwt(req)).toBe('sample-jwt-token');
	});

	it('extracts token from CF_Authorization cookie', () => {
		const req = new Request('https://epoch.example.com', {
			headers: { cookie: 'foo=bar; CF_Authorization=cookie-jwt-token; other=1' }
		});
		expect(extractAccessJwt(req)).toBe('cookie-jwt-token');
	});

	it('extracts token from Authorization: Bearer header', () => {
		const req = new Request('https://epoch.example.com', {
			headers: { authorization: 'Bearer bearer-token' }
		});
		expect(extractAccessJwt(req)).toBe('bearer-token');
	});

	it('rejects expired token', async () => {
		const token = createMockJwt({
			sub: 'user-123',
			email: 'user@example.com',
			iss: 'https://test.cloudflareaccess.com',
			aud: 'test-aud',
			exp: Math.floor(Date.now() / 1000) - 100
		});

		await expect(
			validateAccessJwt(token, { aud: 'test-aud', allowDevBypass: true })
		).rejects.toThrow('expired');
	});

	it('rejects audience mismatch', async () => {
		const token = createMockJwt({
			sub: 'user-123',
			email: 'user@example.com',
			iss: 'https://test.cloudflareaccess.com',
			aud: 'wrong-aud',
			exp: Math.floor(Date.now() / 1000) + 3600
		});

		await expect(
			validateAccessJwt(token, { aud: 'expected-aud', allowDevBypass: true })
		).rejects.toThrow('audience');
	});

	it('validates dev/test bypass token successfully', async () => {
		const token = createMockJwt({
			sub: 'user-456',
			email: 'alex@example.com',
			name: 'Alex Smith',
			iss: 'https://test.cloudflareaccess.com',
			aud: 'my-aud',
			exp: Math.floor(Date.now() / 1000) + 3600
		});

		const user = await validateAccessJwt(token, { aud: 'my-aud', allowDevBypass: true });
		expect(user.accessSub).toBe('user-456');
		expect(user.email).toBe('alex@example.com');
		expect(user.name).toBe('Alex Smith');
	});

	it('enforces role hierarchy and permissions', () => {
		expect(hasMinimumRole('owner', 'manager')).toBe(true);
		expect(hasMinimumRole('editor', 'contributor')).toBe(true);
		expect(hasMinimumRole('viewer', 'editor')).toBe(false);

		// Tree actions
		expect(isActionAllowed('viewer', 'tree:view')).toBe(true);
		expect(isActionAllowed('viewer', 'record:edit')).toBe(false);
		expect(isActionAllowed('contributor', 'record:create')).toBe(true);
		expect(isActionAllowed('contributor', 'record:edit')).toBe(false);
		expect(isActionAllowed('editor', 'record:edit')).toBe(true);
		expect(isActionAllowed('editor', 'tree:manage_members')).toBe(false);
		expect(isActionAllowed('manager', 'tree:manage_members')).toBe(true);
		expect(isActionAllowed('manager', 'tree:delete')).toBe(false);
		expect(isActionAllowed('owner', 'tree:delete')).toBe(true);
		expect(isActionAllowed(null, 'tree:view')).toBe(false);
	});
});

describe('dev bypass fails closed', () => {
	const future = () => Math.floor(Date.now() / 1000) + 3600;
	const prodConfig = { teamDomain: 'team.cloudflareaccess.com', aud: 'my-aud' };

	// An unsigned token must fail without ever needing real network access to the JWKS endpoint.
	beforeEach(() => vi.stubGlobal('fetch', async () => Response.json({ keys: [] })));
	afterEach(() => vi.unstubAllGlobals());

	it('only enables on the exact string "true"', () => {
		expect(isDevBypassEnabled('true')).toBe(true);
		expect(isDevBypassEnabled(undefined, 'true')).toBe(true);
		expect(isDevBypassEnabled()).toBe(false);
		expect(isDevBypassEnabled(undefined, '')).toBe(false);
		expect(isDevBypassEnabled('1', 'TRUE', 'false')).toBe(false);
	});

	it('rejects an alg:none token without the flag', async () => {
		const token = createMockJwt({
			sub: 'attacker',
			email: 'a@example.com',
			iss: 'https://team.cloudflareaccess.com',
			aud: 'my-aud',
			exp: future()
		});
		await expect(validateAccessJwt(token, prodConfig)).rejects.toThrow();
		await expect(
			validateAccessJwt(token, { ...prodConfig, allowDevBypass: false })
		).rejects.toThrow();
	});

	it('rejects a test-issuer token without the flag', async () => {
		const token = createMockJwt(
			{
				sub: 'attacker',
				email: 'a@example.com',
				iss: 'https://test.cloudflareaccess.com',
				aud: 'my-aud',
				exp: future()
			},
			{ alg: 'RS256', kid: 'x' }
		);
		await expect(validateAccessJwt(token, prodConfig)).rejects.toThrow(/Issuer mismatch/);
	});
});

describe('handle hook', () => {
	beforeEach(() => vi.stubGlobal('fetch', async () => Response.json({ keys: [] })));
	afterEach(() => vi.unstubAllGlobals());

	async function run(
		flags: { env?: string; binding?: string },
		headers: Record<string, string> = {},
		origin = 'http://localhost:5173'
	) {
		vi.resetModules();
		vi.doMock('$app/env/public', () => ({ CF_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com' }));
		vi.doMock('$app/env/private', () => ({
			CF_ACCESS_AUD: 'my-aud',
			ACCESS_BYPASS_DEV: flags.env ?? ''
		}));
		vi.doMock('#lib/server/platform.js', () => ({
			getPlatformBindings: () => ({ ACCESS_BYPASS_DEV: flags.binding })
		}));
		const { handle } = await import('../../../hooks.server');
		const event = {
			request: new Request(`${origin}/api/trees`, { headers }),
			url: new URL(`${origin}/api/trees`),
			locals: {} as Record<string, unknown>,
			// SvelteKit's cookie jar, reduced to a read of the request's own `cookie` header.
			cookies: {
				get: (name: string) => new RegExp(`(?:^|; )${name}=([^;]*)`).exec(headers.cookie ?? '')?.[1]
			}
		};
		await handle({ event, resolve: async () => new Response('ok') } as never);
		return event.locals.user as { accessSub: string } | null;
	}

	const forged = () =>
		createMockJwt({
			sub: 'attacker',
			email: 'a@example.com',
			iss: 'https://team.cloudflareaccess.com',
			aud: 'my-aud',
			exp: Math.floor(Date.now() / 1000) + 3600
		});

	it('leaves a tokenless request anonymous without the flag', async () => {
		expect(await run({})).toBeNull();
	});

	it('does not authenticate an alg:none token without the flag', async () => {
		expect(await run({}, { 'cf-access-jwt-assertion': forged() })).toBeNull();
	});

	it('gives a tokenless request the dev user only with the flag', async () => {
		expect((await run({ env: 'true' }))?.accessSub).toBe('dev-local-user');
		expect((await run({ binding: 'true' }))?.accessSub).toBe('dev-local-user');
	});

	it('ignores the flag on a host that is not local, and says so', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const origin = 'https://epoch.example.com';
		expect(await run({ env: 'true' }, {}, origin)).toBeNull();
		expect(await run({ binding: 'true' }, {}, origin)).toBeNull();
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});

	it('takes a second dev identity from a header or a cookie, and only with the flag', async () => {
		const asCookie = { cookie: 'x-dev-user-sub=second-user' };
		expect((await run({ env: 'true' }, { 'x-dev-user-sub': 'header-user' }))?.accessSub).toBe(
			'header-user'
		);
		expect((await run({ env: 'true' }, asCookie))?.accessSub).toBe('second-user');
		// Without the flag a cookie, like a header, buys nothing: the request stays anonymous.
		expect(await run({}, asCookie)).toBeNull();
	});
});

describe('isLocalHostname', () => {
	it.each([
		['localhost', true],
		['127.0.0.1', true],
		['[::1]', true],
		['epoch.example.com', false],
		['localhost.evil.example', false],
		['127.0.0.1.evil.example', false],
		['', false]
	])('%s -> %s', (hostname, isLocal) => {
		expect(isLocalHostname(hostname)).toBe(isLocal);
	});

	it('matches what URL.hostname reports', () => {
		expect(isLocalHostname(new URL('http://localhost:5173/').hostname)).toBe(true);
		expect(isLocalHostname(new URL('http://[::1]:5173/').hostname)).toBe(true);
		expect(isLocalHostname(new URL('https://epoch.example.com/').hostname)).toBe(false);
	});
});

describe('access audience fails closed', () => {
	const future = () => Math.floor(Date.now() / 1000) + 3600;

	// A production token must never reach the signature path to decide whether an unset AUD is
	// acceptable; the audience check has to reject it first, so no fetch is needed.
	beforeEach(() => vi.stubGlobal('fetch', async () => Response.json({ keys: [] })));
	afterEach(() => vi.unstubAllGlobals());

	it('rejects a non-dev token when the audience is unset', async () => {
		const token = createMockJwt(
			{
				sub: 'attacker',
				email: 'a@example.com',
				iss: 'https://team.cloudflareaccess.com',
				aud: 'anything',
				exp: future()
			},
			{ alg: 'RS256', kid: 'x' }
		);
		await expect(
			validateAccessJwt(token, { teamDomain: 'team.cloudflareaccess.com' })
		).rejects.toThrow('Access AUD is not configured');
		await expect(
			validateAccessJwt(token, { teamDomain: 'team.cloudflareaccess.com', aud: '' })
		).rejects.toThrow('Access AUD is not configured');
	});

	it('accepts a dev bypass token when the audience is unset', async () => {
		const token = createMockJwt({
			sub: 'dev-user',
			email: 'dev@example.com',
			iss: 'https://test.cloudflareaccess.com',
			exp: future()
		});
		const user = await validateAccessJwt(token, { allowDevBypass: true });
		expect(user.accessSub).toBe('dev-user');
	});

	it('still enforces a configured audience for a dev bypass token', async () => {
		const token = createMockJwt({
			sub: 'dev-user',
			email: 'dev@example.com',
			iss: 'https://test.cloudflareaccess.com',
			aud: 'wrong',
			exp: future()
		});
		await expect(
			validateAccessJwt(token, { aud: 'expected', allowDevBypass: true })
		).rejects.toThrow('audience');
	});
});
