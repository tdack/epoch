import { describe, expect, it } from 'vitest';
import { isHandledRequest, isShellFile } from './service-worker-rules';

describe('isShellFile', () => {
	it('takes icons, manifest and the offline page', () => {
		for (const p of [
			'/brand/icon-192.png',
			'/brand/apple-touch-icon.png',
			'/brand/manifest.webmanifest',
			'/offline.html',
			'/favicon.svg'
		])
			expect(isShellFile(p)).toBe(true);
	});
	it('leaves splash images and dynamic paths out', () => {
		for (const p of ['/brand/splash-library.jpg', '/brand/og-image.png', '/api/x', '/media/1', '/'])
			expect(isShellFile(p)).toBe(false);
	});
});

describe('isHandledRequest', () => {
	it('handles only same-origin GETs', () => {
		expect(isHandledRequest('GET', 'https://a', 'https://a')).toBe(true);
		expect(isHandledRequest('POST', 'https://a', 'https://a')).toBe(false);
		expect(isHandledRequest('GET', 'https://b', 'https://a')).toBe(false);
	});
});
