import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	PUBLIC_PASS_TTL_SECONDS,
	PUBLIC_READ_ACTION,
	isPublicPassValid,
	issuePublicPass,
	verifyTurnstileToken
} from './public-pass';

const NOW = 1_800_000_000_000;

describe('public pass', () => {
	it('accepts a pass it issued until it expires', async () => {
		const pass = await issuePublicPass('s', NOW);
		expect(await isPublicPassValid(pass, 's', NOW)).toBe(true);
		expect(await isPublicPassValid(pass, 's', NOW + PUBLIC_PASS_TTL_SECONDS * 1000)).toBe(false);
	});

	it('refuses a missing, malformed, tampered or foreign pass', async () => {
		const pass = await issuePublicPass('s', NOW);
		const [expires, signature] = pass.split('.') as [string, string];
		expect(await isPublicPassValid(undefined, 's', NOW)).toBe(false);
		expect(await isPublicPassValid('nonsense', 's', NOW)).toBe(false);
		expect(await isPublicPassValid(`${Number(expires) + 9999}.${signature}`, 's', NOW)).toBe(false);
		expect(await isPublicPassValid(pass, 'other', NOW)).toBe(false);
	});
});

describe('verifyTurnstileToken', () => {
	afterEach(() => vi.unstubAllGlobals());

	const check = { secret: 's', token: 't', remoteIp: '1.2.3.4', hostname: 'epoch.test' };
	function answer(body: unknown, status = 200) {
		const fetchMock = vi.fn(async () => Response.json(body, { status }));
		vi.stubGlobal('fetch', fetchMock);
		return fetchMock;
	}

	it('accepts a token solved for this action on this host', async () => {
		const fetchMock = answer({ success: true, action: PUBLIC_READ_ACTION, hostname: 'epoch.test' });
		expect(await verifyTurnstileToken(check)).toBe(true);
		const body = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body;
		expect(String(body)).toContain('remoteip=1.2.3.4');
	});

	it.each([
		['failure', { success: false, action: PUBLIC_READ_ACTION, hostname: 'epoch.test' }],
		['another action', { success: true, action: 'signup', hostname: 'epoch.test' }],
		['another host', { success: true, action: PUBLIC_READ_ACTION, hostname: 'localhost' }]
	])('refuses %s', async (_label, body) => {
		answer(body);
		expect(await verifyTurnstileToken(check)).toBe(false);
	});

	it('fails closed when siteverify errors or is unreachable', async () => {
		answer({}, 500);
		expect(await verifyTurnstileToken(check)).toBe(false);
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
		expect(await verifyTurnstileToken(check)).toBe(false);
	});

	it('refuses a missing or oversized token without calling siteverify', async () => {
		const fetchMock = answer({ success: true });
		expect(await verifyTurnstileToken({ ...check, token: null })).toBe(false);
		expect(await verifyTurnstileToken({ ...check, token: 'x'.repeat(2049) })).toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
