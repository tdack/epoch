import { afterEach, describe, expect, it, vi } from 'vitest';
import wranglerText from '../../../../wrangler.jsonc?raw';
import { RateLimitedError } from '../domain/errors';
import { FakeRateLimit } from '../testing/fake-rate-limit';
import { errorResponse } from './error-response';
import {
	CSP_REPORT_RATE_LIMIT_PER_MINUTE,
	enforceRateLimit,
	IMPORT_RATE_LIMIT_PER_MINUTE,
	RATE_LIMIT_PERIOD_SECONDS,
	resetRateLimitWarnings,
	UPLOAD_RATE_LIMIT_PER_MINUTE
} from './rate-limit';

afterEach(() => {
	resetRateLimitWarnings();
	vi.restoreAllMocks();
});

const check = (binding: RateLimit | undefined) => ({
	binding,
	bindingName: 'TEST_RATE_LIMIT',
	key: 'user-1',
	message: 'Too many'
});

describe('enforceRateLimit', () => {
	it('passes a request under the limit, counting it by key', async () => {
		const binding = new FakeRateLimit(1);
		await expect(enforceRateLimit(check(binding))).resolves.toBeUndefined();
		expect(binding.keys).toEqual(['user-1']);
	});

	it('throws a 429 error carrying the retry delay once over the limit', async () => {
		const binding = new FakeRateLimit(0);
		const error = await enforceRateLimit(check(binding)).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(RateLimitedError);
		const response = errorResponse(error, 'Failed');
		expect(response.status).toBe(429);
		expect(response.headers.get('Retry-After')).toBe(String(RATE_LIMIT_PERIOD_SECONDS));
		expect(await response.json()).toEqual({
			error: 'Too many',
			code: 'RATE_LIMITED',
			details: { retryAfterSeconds: RATE_LIMIT_PERIOD_SECONDS }
		});
	});

	it('allows the request and logs once when the binding is missing', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		await enforceRateLimit(check(undefined));
		await enforceRateLimit(check(undefined));
		expect(warn).toHaveBeenCalledTimes(1);
	});
});

describe('wrangler.jsonc ratelimits', () => {
	// Whole-line comments only: the file's URLs contain `//`, and the root has no JSONC parser.
	const config = JSON.parse(
		wranglerText
			.split('\n')
			.filter((line: string) => !line.trim().startsWith('//'))
			.join('\n')
	);
	const byName = Object.fromEntries(
		(config.ratelimits as { name: string; simple: { limit: number; period: number } }[]).map(
			(entry) => [entry.name, entry.simple]
		)
	);

	it.each([
		['UPLOAD_RATE_LIMIT', UPLOAD_RATE_LIMIT_PER_MINUTE],
		['IMPORT_RATE_LIMIT', IMPORT_RATE_LIMIT_PER_MINUTE],
		['CSP_REPORT_RATE_LIMIT', CSP_REPORT_RATE_LIMIT_PER_MINUTE]
	])('%s agrees with its constant', (name, perMinute) => {
		expect(byName[name]).toEqual({ limit: perMinute, period: RATE_LIMIT_PERIOD_SECONDS });
	});
});
