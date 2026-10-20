import { describe, expect, it, vi } from 'vitest';
import { allowedPictureUrl, fetchAccessPicture } from './access-picture';
import { MAX_AVATAR_BYTES } from '../../shared/profile';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const GOOD = 'https://lh3.googleusercontent.com/a/photo=s96-c';

const respond = (body: Uint8Array | string, init?: ResponseInit) =>
	vi.fn(async () => new Response(body as BodyInit, init)) as unknown as typeof fetch;

describe('allowedPictureUrl', () => {
	it('allows https on googleusercontent.com subdomains only', () => {
		expect(allowedPictureUrl(GOOD)).not.toBeNull();
		for (const bad of [
			'http://lh3.googleusercontent.com/a',
			'https://googleusercontent.com/a',
			'https://evil.example/?x=.googleusercontent.com',
			'https://lh3.googleusercontent.com.evil.example/a',
			'https://169.254.169.254/latest',
			'https://lh3.googleusercontent.com:8443/a',
			'https://user:pw@lh3.googleusercontent.com/a',
			'not a url'
		]) {
			expect(allowedPictureUrl(bad), bad).toBeNull();
		}
	});
});

describe('fetchAccessPicture', () => {
	it('returns the sniffed image', async () => {
		const got = await fetchAccessPicture(GOOD, respond(PNG));
		expect(got?.mimeType).toBe('image/png');
		expect(got?.bytes).toEqual(PNG);
	});

	it('never fetches a refused URL', async () => {
		const fetchFn = respond(PNG);
		expect(await fetchAccessPicture('https://evil.example/a.png', fetchFn)).toBeNull();
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it('refuses non-images, redirects, errors, oversize bodies and thrown fetches', async () => {
		expect(await fetchAccessPicture(GOOD, respond('<html></html>'))).toBeNull();
		expect(await fetchAccessPicture(GOOD, respond(PNG, { status: 404 }))).toBeNull();
		expect(
			await fetchAccessPicture(
				GOOD,
				respond(null as never, { status: 302, headers: { location: 'https://x' } })
			)
		).toBeNull();
		const big = new Uint8Array(MAX_AVATAR_BYTES + 1);
		big.set(PNG);
		expect(await fetchAccessPicture(GOOD, respond(big))).toBeNull();
		const failing = vi.fn(async () => {
			throw new Error('network');
		}) as unknown as typeof fetch;
		expect(await fetchAccessPicture(GOOD, failing)).toBeNull();
	});
});
