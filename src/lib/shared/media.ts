/**
 * What Epoch accepts for uploads and what it will serve inline. Shared between the upload route and
 * the media component so the client's `accept` list and the server's allowlist cannot drift, and so
 * the browser is told a file cannot render inline even before the server rejects it.
 *
 * The inline set is an exact-match allowlist, never a `startsWith('image/')` test: `image/svg+xml`
 * carries script and must not qualify.
 */

export const INLINE_MEDIA_TYPES = [
	'image/jpeg',
	'image/png',
	'image/gif',
	'image/webp',
	'image/avif'
] as const;

export type InlineMediaType = (typeof INLINE_MEDIA_TYPES)[number];

/**
 * Accepted for upload but never served inline: most browsers cannot render HEIC/HEIF, so an `<img>`
 * would show a broken image. They are stored and served as downloads, and the UI falls back to its
 * no-preview icon, as it does for a PDF.
 */
const DOWNLOAD_ONLY_IMAGE_TYPES = ['image/heic', 'image/heif'] as const;

export const UPLOAD_MEDIA_TYPES = [
	...INLINE_MEDIA_TYPES,
	...DOWNLOAD_ONLY_IMAGE_TYPES,
	'application/pdf'
] as const;

export type UploadMediaType = (typeof UPLOAD_MEDIA_TYPES)[number];

/** The upload input's `accept` attribute, built from the same list the server enforces. */
export const MEDIA_UPLOAD_ACCEPT = UPLOAD_MEDIA_TYPES.join(',');

/**
 * How many bytes a stored media file may carry. The upload route counts the request body as it
 * streams and aborts once that count passes this plus a little multipart framing, so an oversized
 * body is never buffered whole; the parsed file size is then checked against this exactly.
 */
export const MAX_MEDIA_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * How many bytes one tree's stored media may total. A soft quota: the total is read before a write
 * and the write follows, so two uploads racing at the edge can each pass and overshoot by at most
 * one file each. Bounding the total, not each request, is what stops a collaborator's repeated
 * uploads from growing R2 without limit.
 */
export const MAX_TREE_MEDIA_BYTES = 2 * 1024 * 1024 * 1024;

/** Whether a stored type may be rendered inline on our own origin. */
export function isInlineMediaType(mime: string | undefined | null): mime is InlineMediaType {
	return mime != null && (INLINE_MEDIA_TYPES as readonly string[]).includes(mime);
}

/** Whether a sniffed type is one an upload is allowed to carry. */
export function isUploadMediaType(mime: string): mime is UploadMediaType {
	return (UPLOAD_MEDIA_TYPES as readonly string[]).includes(mime);
}

const EXTENSION_BY_MEDIA_TYPE: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/gif': 'gif',
	'image/webp': 'webp',
	'image/avif': 'avif',
	'image/heic': 'heic',
	'image/heif': 'heif',
	'application/pdf': 'pdf'
};

/** The key extension for an accepted type, or null when the type is not accepted. */
export function extensionForMediaType(mime: string): string | null {
	return EXTENSION_BY_MEDIA_TYPE[mime] ?? null;
}

/** The longest title a stored file may be given; longer input is refused, not truncated. */
export const MAX_MEDIA_TITLE_LENGTH = 200;

/**
 * Older media responses were cached as immutable for a year, so a browser keeps them until the URL
 * changes. The version query is what evicts them after the serve path changed; bump it when the
 * bytes a URL returns can change again.
 */
const MEDIA_URL_VERSION = 2;

/** The address a stored file is read from. Every screen that shows a file uses this, so the version stays in one place. */
export function mediaUrl(objectKey: string): string {
	return `/api/media/${objectKey}?v=${MEDIA_URL_VERSION}`;
}

/** A stored file's size for people to read; "Unknown" until it has been recorded. */
export function formatMediaSize(bytes: number | null): string {
	if (bytes === null) return 'Unknown';
	if (bytes < 1024) return `${bytes} B`;
	const units = ['KB', 'MB', 'GB', 'TB'];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}
