import { sniffMediaType } from './media-type';
import { isInlineMediaType } from '../../shared/media';
import { MAX_AVATAR_BYTES } from '../../shared/profile';

/** Where Google serves profile pictures from; nothing else is fetched on a token's say-so. */
const PICTURE_HOST_SUFFIX = '.googleusercontent.com';
const PICTURE_FETCH_TIMEOUT_MS = 5_000;

/**
 * The URL only if it is an https address on Google's picture host. The address comes from a token
 * claim an admin configures, but fetching whatever it names would still let a misconfigured or
 * spoofed IdP aim the Worker at an internal address (SSRF).
 */
export function allowedPictureUrl(raw: string): URL | null {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return null;
	}
	const isAllowed =
		url.protocol === 'https:' &&
		url.hostname.endsWith(PICTURE_HOST_SUFFIX) &&
		url.port === '' &&
		url.username === '' &&
		url.password === '';
	return isAllowed ? url : null;
}

/**
 * Downloads an Access-supplied picture, or null for anything that is not a small image: a refused
 * URL, a failed or slow request, a redirect, a body over the cap, or bytes that are not an inline
 * image type. Never throws, because the caller falls back to initials either way.
 */
export async function fetchAccessPicture(
	raw: string,
	fetchFn: typeof fetch = fetch
): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
	const url = allowedPictureUrl(raw);
	if (!url) return null;
	try {
		// `manual`: a redirect would leave the host the check above approved.
		const response = await fetchFn(url, {
			redirect: 'manual',
			signal: AbortSignal.timeout(PICTURE_FETCH_TIMEOUT_MS)
		});
		if (!response.ok || !response.body) return null;
		const declared = Number(response.headers.get('content-length'));
		if (Number.isFinite(declared) && declared > MAX_AVATAR_BYTES) return null;

		// Counted as it streams: the declared length may be absent or understated.
		const chunks: Uint8Array[] = [];
		let total = 0;
		const reader = response.body.getReader();
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > MAX_AVATAR_BYTES) {
				await reader.cancel();
				return null;
			}
			chunks.push(value);
		}
		const bytes = new Uint8Array(total);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		const mimeType = sniffMediaType(bytes);
		return isInlineMediaType(mimeType) ? { bytes, mimeType } : null;
	} catch {
		return null;
	}
}
