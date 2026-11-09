import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/env/public', () => ({ CF_ACCESS_TEAM_DOMAIN: 'team.example' }));
vi.mock('$app/env/private', () => ({ CF_ACCESS_AUD: 'aud', ACCESS_BYPASS_DEV: '' }));
const bindings: Record<string, unknown> = { DB: {} };
vi.mock('#lib/server/platform.js', () => ({ getPlatformBindings: () => bindings }));
vi.mock('#lib/server/db/schema-status.js', () => ({
	isSchemaCurrent: async () => true,
	SCHEMA_NOT_MIGRATED_CODE: 'SCHEMA_NOT_MIGRATED',
	SCHEMA_NOT_MIGRATED_MESSAGE: 'migrate'
}));
vi.mock('#lib/server/auth/access.js', () => ({
	extractAccessJwt: vi.fn(() => 'token'),
	isDevBypassEnabled: () => false,
	isLocalHostname: () => false,
	validateAccessJwt: vi.fn()
}));
vi.mock('#lib/server/auth/resolve-user.js', () => ({ resolveUser: vi.fn() }));
vi.mock('#lib/server/services/public-tree-service.js', () => ({
	PublicTreeService: class {
		async current() {
			return { id: 'pub', slug: 'pub' };
		}
	}
}));

import { handle } from './hooks.server';
import { extractAccessJwt, validateAccessJwt } from '#lib/server/auth/access.js';
import { resolveUser } from '#lib/server/auth/resolve-user.js';
import { issuePublicPass, PUBLIC_PASS_COOKIE } from '#lib/server/auth/public-pass.js';

function run(path: string, cookie?: string) {
	const resolve = vi.fn(async () => new Response('ok'));
	const event = {
		url: new URL(`https://epoch.test${path}`),
		request: new Request(`https://epoch.test${path}`),
		locals: {},
		isDataRequest: false,
		cookies: { get: (name: string) => (name === PUBLIC_PASS_COOKIE ? cookie : undefined) },
		platform: undefined
	};
	return { resolve, result: handle({ event, resolve } as unknown as Parameters<typeof handle>[0]) };
}

const VALIDATED = { accessSub: 's', email: 'a@b.test', name: 'A', id: 'u' } as never;

beforeEach(() => {
	vi.mocked(validateAccessJwt).mockReset();
	vi.mocked(resolveUser).mockReset();
	vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('handle: Access identity', () => {
	it('answers an API call with 503 when the user lookup fails', async () => {
		vi.mocked(validateAccessJwt).mockResolvedValue(VALIDATED);
		vi.mocked(resolveUser).mockRejectedValue(new Error('D1 down'));
		const response = await run('/api/trees').result;
		expect(response.status).toBe(503);
	});

	it('lets a failed user lookup surface on a page load rather than redirecting to login', async () => {
		vi.mocked(validateAccessJwt).mockResolvedValue(VALIDATED);
		vi.mocked(resolveUser).mockRejectedValue(new Error('D1 down'));
		await expect(run('/trees').result).rejects.toThrow('D1 down');
	});

	it('still sends a page load with an invalid token to login', async () => {
		vi.mocked(validateAccessJwt).mockRejectedValue(new Error('bad token'));
		const response = await run('/trees').result;
		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toMatch(/^\/login/);
		expect(resolveUser).not.toHaveBeenCalled();
	});
});

describe('handle: the public tree', () => {
	it('answers 429 to an address reading the public tree too fast', async () => {
		vi.mocked(extractAccessJwt).mockReturnValueOnce(null);
		bindings.PUBLIC_READ_RATE_LIMIT = { limit: async () => ({ success: false }) };
		try {
			const { resolve, result } = run('/api/trees/t/people');
			const response = await result;
			expect(response.status).toBe(429);
			expect(resolve).not.toHaveBeenCalled();
		} finally {
			delete bindings.PUBLIC_READ_RATE_LIMIT;
		}
	});
});

describe('handle: the public-read challenge (ADR-084)', () => {
	beforeEach(() => {
		vi.mocked(extractAccessJwt).mockReturnValueOnce(null);
		bindings.TURNSTILE_SITE_KEY = 'site';
		bindings.TURNSTILE_SECRET = 'secret';
		return () => {
			delete bindings.TURNSTILE_SITE_KEY;
			delete bindings.TURNSTILE_SECRET;
		};
	});

	it('refuses an anonymous API read without a pass with a 403, never a 401', async () => {
		const { resolve, result } = run('/api/trees/pub/people');
		expect((await result).status).toBe(403);
		expect(resolve).not.toHaveBeenCalled();
	});

	it('sends an anonymous page read without a pass to the challenge, keeping the address', async () => {
		const response = await run('/trees/pub/people?x=1').result;
		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe(
			`/verify?next=${encodeURIComponent('/trees/pub/people?x=1')}`
		);
	});

	it('serves an anonymous read that carries a valid pass', async () => {
		const { resolve, result } = run('/trees/pub', await issuePublicPass('secret'));
		expect((await result).status).toBe(200);
		expect(resolve).toHaveBeenCalled();
	});

	it('refuses every anonymous read when the secret is missing', async () => {
		const pass = await issuePublicPass('secret');
		delete bindings.TURNSTILE_SECRET;
		expect((await run('/api/trees/pub/people', pass).result).status).toBe(403);
	});
});
