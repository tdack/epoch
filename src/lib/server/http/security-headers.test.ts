import { describe, expect, it } from 'vitest';
import { applySecurityHeaders, securityHeadersFor } from './security-headers';

const PRODUCTION = new URL('https://epoch.example.com/trees/the-windsors');

describe('securityHeadersFor', () => {
	it('pins https production traffic to HSTS, without preload', () => {
		expect(securityHeadersFor(PRODUCTION)).toMatchObject({
			'Strict-Transport-Security': 'max-age=31536000',
			'X-Frame-Options': 'DENY',
			'Referrer-Policy': 'strict-origin-when-cross-origin',
			'X-Content-Type-Options': 'nosniff',
			'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
		});
		expect(securityHeadersFor(PRODUCTION)['Strict-Transport-Security']).not.toContain('preload');
	});

	it.each([
		['plain http', 'http://epoch.example.com/'],
		['https on localhost', 'https://localhost:5173/'],
		['https on a .localhost name', 'https://epoch.localhost/'],
		['https on 127.0.0.1', 'https://127.0.0.1:8787/']
	])('omits HSTS for %s, while keeping the other headers', (_label, href) => {
		const headers = securityHeadersFor(new URL(href));
		expect(headers).not.toHaveProperty('Strict-Transport-Security');
		expect(headers['X-Frame-Options']).toBe('DENY');
	});
});

describe('applySecurityHeaders', () => {
	it('adds the headers to a response that has none', () => {
		const response = applySecurityHeaders(new Response('ok'), PRODUCTION);
		expect(response.headers.get('X-Frame-Options')).toBe('DENY');
		expect(response.headers.get('Strict-Transport-Security')).toContain('max-age=31536000');
	});

	it('keeps a header the route already set, such as the media route sandbox', () => {
		const response = new Response('media', {
			headers: {
				'Content-Security-Policy': 'sandbox',
				'Referrer-Policy': 'no-referrer',
				'X-Content-Type-Options': 'nosniff'
			}
		});
		applySecurityHeaders(response, PRODUCTION);
		expect(response.headers.get('Content-Security-Policy')).toBe('sandbox');
		expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
		expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
		expect(response.headers.get('X-Frame-Options')).toBe('DENY');
	});

	it('returns the same response object', () => {
		const response = new Response(null, { status: 303 });
		expect(applySecurityHeaders(response, PRODUCTION)).toBe(response);
	});
});
