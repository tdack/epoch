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
 * How many bytes one tree's stored media may total. A soft quota: the total is read before a write
 * and the write follows, so two uploads racing at the edge can each pass and overshoot by at most
 * one file each. Bounding the total, not each request, is what stops a collaborator's repeated
 * uploads from growing R2 without limit.
 */
export const MAX_TREE_MEDIA_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * How large one media file may be, however it arrives (a chunked upload or a `.gdz` entry). Not the
 * quota: a file this size is a long recording or a large scan, and a family tree is the wrong home
 * for video, so the cap stops one file taking a quarter of the tree's room.
 */
export const MAX_MEDIA_FILE_BYTES = 500 * 1024 * 1024;

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

/**
 * A link's row id: `<mediaId>:<entityId>` for a pointer on the record, `<mediaId>:<entityId>:<factId>`
 * for one under a fact (ADR-082). `mediaId` names an object, and for the life of the expand phase an
 * object's id is its first file's id, so a legacy link needs no rewrite.
 */
export function mediaLinkId(mediaId: string, entityId: string, factId?: string | null): string {
	return factId ? `${mediaId}:${entityId}:${factId}` : `${mediaId}:${entityId}`;
}

/**
 * The object a file belongs to. A null `object_id` is a file written before the backfill (ADR-082,
 * migration step 3), and means "an object whose id is the file's own id". Every reader that needs
 * an object goes through here so that fallback lives in one place.
 */
export function objectIdOf(file: { id: string; objectId: string | null }): string {
	return file.objectId ?? file.id;
}

/** Whether a file's bytes are not in Epoch. A null status is `resolved`, which every older row is. */
export function isUnresolvedFile(file: { status: string | null }): boolean {
	return file.status === 'unresolved';
}

/**
 * The key an unresolved file holds in `r2_object_key`, which stays NOT NULL until the contract
 * migrations (ADR-082). It names no bucket object: `parseMediaKey` refuses it.
 */
export function unresolvedMediaKey(itemId: string): string {
	return `unresolved/${itemId}`;
}

/**
 * Whether a `FILE` text is a web address a person may follow. Only `http:` and `https:` qualify: a
 * `file:` URI, a Windows path and a relative reference are text, and `javascript:` or `data:` must
 * never become a link (ADR-082). Nothing here fetches; the UI opens it only on a click.
 */
export function isWebUrl(path: string | null | undefined): path is string {
	if (!path) return false;
	try {
		const { protocol } = new URL(path);
		return protocol === 'http:' || protocol === 'https:';
	} catch {
		// A relative reference or a Windows path does not parse as an absolute URL.
		return false;
	}
}

/**
 * What to call an unresolved file: its title, else the last segment of the path it was written
 * with (either slash, no query), else a plain "Missing file".
 */
export function unresolvedFileLabel(file: {
	title: string | null;
	gedcomPath: string | null;
}): string {
	const title = file.title?.trim();
	if (title) return title;
	const last = (file.gedcomPath ?? '')
		.split(/[?#]/)[0]!
		.split(/[\\/]/)
		.filter((part) => part !== '')
		.pop();
	return last ?? 'Missing file';
}

/** The summary of an object's details: "+2 files" when it has more than its first, else just "Details". */
export function extraFilesLabel(extraCount: number): string {
	if (extraCount <= 0) return 'Details';
	return `+${extraCount} ${extraCount === 1 ? 'file' : 'files'}`;
}

/** One file of a media object, in the shape every screen can supply for its details. */
export interface ObjectFileView {
	id: string;
	title: string | null;
	/** The file row's version, sent back when the file is resolved. */
	version: number;
	mimeType: string;
	sizeBytes: number | null;
	isUnresolved: boolean;
	/** The `FILE` text as written. Plain text unless it is an http(s) address; never fetched. */
	gedcomPath: string | null;
	/** The stored key to open the file by; null when unresolved or when the viewer may not preview. */
	previewKey: string | null;
}

/** A pointer's crop in whole pixels; all four are set or none is. */
export interface MediaCrop {
	top: number;
	left: number;
	height: number;
	width: number;
}
