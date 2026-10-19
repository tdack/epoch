import type { RequestEvent } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { FakeRateLimit } from '#lib/server/testing/fake-rate-limit.js';
import { POST } from './+server.js';

function report(limiter?: FakeRateLimit) {
	return POST({
		request: new Request('http://epoch.test/api/csp-report', {
			method: 'POST',
			headers: { 'cf-connecting-ip': '203.0.113.7' },
			body: '{}'
		}),
		locals: { correlationId: 'c1' },
		url: new URL('http://epoch.test/api/csp-report'),
		platform: { env: { CSP_REPORT_RATE_LIMIT: limiter } }
	} as unknown as RequestEvent);
}

describe('POST /api/csp-report rate limit', () => {
	it('accepts a report under the limit, counting by client address', async () => {
		const limiter = new FakeRateLimit(1);
		expect((await report(limiter)).status).toBe(204);
		expect(limiter.keys).toEqual(['203.0.113.7']);
	});

	it('answers 429 with Retry-After over the limit', async () => {
		const response = await report(new FakeRateLimit(0));
		expect(response.status).toBe(429);
		expect(response.headers.get('Retry-After')).toBe('60');
		expect(((await response.json()) as { code: string }).code).toBe('RATE_LIMITED');
	});

	it('accepts the report when the binding is missing', async () => {
		expect((await report()).status).toBe(204);
	});
});
