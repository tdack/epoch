import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/env/public', () => ({ CF_ACCESS_TEAM_DOMAIN: 'team.example' }));
vi.mock('$app/env/private', () => ({ CF_ACCESS_AUD: 'aud', ACCESS_BYPASS_DEV: '' }));
vi.mock('#lib/server/platform.js', () => ({ getPlatformBindings: () => ({ DB: {} }) }));
vi.mock('#lib/server/db/schema-status.js', () => ({
	isSchemaCurrent: async () => true,
	SCHEMA_NOT_MIGRATED_CODE: 'SCHEMA_NOT_MIGRATED',
	SCHEMA_NOT_MIGRATED_MESSAGE: 'migrate'
}));
vi.mock('#lib/server/auth/access.js', () => ({
	extractAccessJwt: () => 'token',
	isDevBypassEnabled: () => false,
	isLocalHostname: () => false,
	validateAccessJwt: vi.fn()
}));
vi.mock('#lib/server/auth/resolve-user.js', () => ({ resolveUser: vi.fn() }));

import { handle } from './hooks.server';
import { validateAccessJwt } from '#lib/server/auth/access.js';
import { resolveUser } from '#lib/server/auth/resolve-user.js';

function run(path: string) {
	const resolve = vi.fn(async () => new Response('ok'));
	const event = {
		url: new URL(`https://epoch.test${path}`),
		request: new Request(`https://epoch.test${path}`),
		locals: {},
		isDataRequest: false,
		cookies: { get: () => undefined },
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
