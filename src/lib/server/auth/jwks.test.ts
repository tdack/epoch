/**
 * The Access certs cache. A rotated signing key must be picked up from an unknown `kid`, but a
 * flood of tokens naming a bogus kid must not hammer the certs endpoint, and an old key must stop
 * being trusted once the staleness bound is passed. Each case runs on a fresh module instance so
 * the module-level cache does not leak between tests.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

const TEAM = 'jwks-team.cloudflareaccess.com';
const ISSUER = `https://${TEAM}`;

function b64Url(value: unknown): string {
	return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function token(kid: string): string {
	const header = { alg: 'RS256', kid, typ: 'JWT' };
	const payload = {
		sub: 'user',
		email: 'user@example.com',
		iss: ISSUER,
		aud: 'aud',
		exp: Math.floor(Date.now() / 1000) + 3600
	};
	return `${b64Url(header)}.${b64Url(payload)}.mockSignature`;
}

function jwk(kid: string) {
	return { kid, kty: 'RSA', alg: 'RS256', use: 'sig', n: 'AQAB', e: 'AQAB' };
}

type Validate = (token: string, config: { teamDomain: string; aud?: string }) => Promise<unknown>;

async function loadValidate(): Promise<Validate> {
	vi.resetModules();
	const mod = await import('./access');
	return mod.validateAccessJwt as Validate;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('Access certs refresh', () => {
	it('refetches at most once for repeated unknown kids', async () => {
		const validate = await loadValidate();
		let calls = 0;
		vi.stubGlobal('fetch', async () => {
			calls++;
			return Response.json({ keys: [jwk('known')] });
		});

		await expect(validate(token('unknown'), { teamDomain: TEAM, aud: 'aud' })).rejects.toThrow(
			/No matching key/
		);
		// One initial fetch, one forced refetch for the rotated key we never had.
		expect(calls).toBe(2);

		// Within the force interval a second and third unknown kid add no requests.
		await expect(validate(token('unknown'), { teamDomain: TEAM, aud: 'aud' })).rejects.toThrow(
			/No matching key/
		);
		await expect(validate(token('unknown'), { teamDomain: TEAM, aud: 'aud' })).rejects.toThrow(
			/No matching key/
		);
		expect(calls).toBe(2);
	});

	it('proceeds with a key returned by the forced refetch', async () => {
		const validate = await loadValidate();
		let calls = 0;
		vi.stubGlobal('fetch', async () => {
			calls++;
			return Response.json({ keys: calls === 1 ? [jwk('old')] : [jwk('old'), jwk('rotated')] });
		});

		// The initial fetch lacks `rotated`; the forced refetch supplies it, so the lookup succeeds
		// and the request fails later at signature verification rather than "No matching key".
		await expect(validate(token('rotated'), { teamDomain: TEAM, aud: 'aud' })).rejects.not.toThrow(
			/No matching key/
		);
		expect(calls).toBe(2);
	});

	it('keeps the cached keys when a forced refetch fails', async () => {
		const validate = await loadValidate();
		let calls = 0;
		vi.stubGlobal('fetch', async () => {
			calls++;
			if (calls === 1) return Response.json({ keys: [jwk('old')] });
			throw new Error('certs endpoint unreachable');
		});

		await expect(validate(token('missing'), { teamDomain: TEAM, aud: 'aud' })).rejects.toThrow(
			/No matching key/
		);
		expect(calls).toBe(2);

		// The old keys are still cached: a token for `old` gets past the lookup and fails later.
		await expect(validate(token('old'), { teamDomain: TEAM, aud: 'aud' })).rejects.not.toThrow(
			/No matching key/
		);
	});

	it('requests the certs endpoint with an abort signal', async () => {
		const validate = await loadValidate();
		let seen: RequestInit | undefined;
		vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
			seen = init;
			return Response.json({ keys: [jwk('old')] });
		});

		await expect(validate(token('x'), { teamDomain: TEAM, aud: 'aud' })).rejects.toThrow(
			/No matching key/
		);
		expect(seen?.signal).toBeInstanceOf(AbortSignal);
		expect(seen?.signal?.aborted).toBe(false);
	});

	it('coalesces concurrent fetches into one request', async () => {
		const validate = await loadValidate();
		let calls = 0;
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		vi.stubGlobal('fetch', async () => {
			calls++;
			await gate;
			return Response.json({ keys: [jwk('kept')] });
		});

		// Both tokens name the key the single response carries, so neither triggers a forced refetch:
		// the only fetch in play is the shared initial one.
		const first = validate(token('kept'), { teamDomain: TEAM, aud: 'aud' });
		const second = validate(token('kept'), { teamDomain: TEAM, aud: 'aud' });
		expect(calls).toBe(1);
		release();
		await Promise.allSettled([first, second]);

		expect(calls).toBe(1);
	});
});
