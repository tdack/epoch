/**
 * Path rules for a GEDZip: which archive entries are safe names, which entry a `FILE` payload
 * means, and which entries become files in Epoch (ADR-082).
 *
 * An entry name is a literal string, not a URI: the archive's own names are never percent-decoded.
 * A `FILE` payload is the opposite, a URI reference, so it is decoded before it is looked up. Mixing
 * the two up is how `%2e%2e/` becomes a traversal, so each decode happens exactly once, here, and
 * the result goes through the same name check as an entry does.
 */

import { ValidationError } from '../domain/errors';
import { extensionForMediaType, isInlineMediaType, isUploadMediaType } from '../../shared/media';

/**
 * The longest entry name accepted, in UTF-8 bytes. Zip allows 65,535; no real archive's media path
 * comes near this, and a long name is only useful for hiding one.
 */
export const MAX_ENTRY_NAME_BYTES = 1024;

/**
 * Audio, video and transcript types a `.gdz` may carry beyond `UPLOAD_MEDIA_TYPES` (owner decision
 * 2 of ADR-082). They are stored and served as downloads, never inline, so the official
 * `maximal70.gdz` round-trips. The list is explicit rather than `audio/*` so a new type is a
 * decision, and `image/svg+xml` and HTML can never arrive through a prefix test.
 */
export const GEDZIP_DOWNLOAD_ONLY_TYPES = [
	'audio/mpeg',
	'audio/ogg',
	'audio/wav',
	'audio/x-wav',
	'audio/mp4',
	'audio/flac',
	'audio/aac',
	'audio/webm',
	'video/mp4',
	'video/webm',
	'video/ogg',
	'video/quicktime',
	'text/vtt'
] as const;

type GedzipDownloadOnlyType = (typeof GEDZIP_DOWNLOAD_ONLY_TYPES)[number];

const EXTENSIONS_BY_TYPE: Record<string, string> = {
	'audio/mpeg': 'mp3',
	'audio/ogg': 'oga',
	'audio/wav': 'wav',
	'audio/x-wav': 'wav',
	'audio/mp4': 'm4a',
	'audio/flac': 'flac',
	'audio/aac': 'aac',
	'audio/webm': 'weba',
	'video/mp4': 'mp4',
	'video/webm': 'webm',
	'video/ogg': 'ogv',
	'video/quicktime': 'mov',
	'text/vtt': 'vtt'
};

/**
 * The type implied by a file extension, used only when the bytes have not been sniffed yet. A
 * hint for the preview's counts; the import must still sniff, because a name proves nothing.
 */
const TYPE_BY_EXTENSION: Record<string, string> = {
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	gif: 'image/gif',
	webp: 'image/webp',
	avif: 'image/avif',
	heic: 'image/heic',
	heif: 'image/heif',
	pdf: 'application/pdf',
	mp3: 'audio/mpeg',
	oga: 'audio/ogg',
	ogg: 'audio/ogg',
	wav: 'audio/wav',
	m4a: 'audio/mp4',
	flac: 'audio/flac',
	aac: 'audio/aac',
	weba: 'audio/webm',
	mp4: 'video/mp4',
	webm: 'video/webm',
	ogv: 'video/ogg',
	mov: 'video/quicktime',
	vtt: 'text/vtt'
};

const isDownloadOnlyType = (mime: string): mime is GedzipDownloadOnlyType =>
	(GEDZIP_DOWNLOAD_ONLY_TYPES as readonly string[]).includes(mime);

// C0 and C1 controls, DEL, and the bidirectional overrides that make a name display as another.
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARACTERS = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/u;
const DRIVE_LETTER = /^[A-Za-z]:/;
const UTF8_ENCODER = new TextEncoder();

/**
 * The name an entry is known by, or a `ValidationError` saying why it is refused. The canonical
 * form is the name itself: paths are case-sensitive in 7.0 and on R2, and rewriting a name would
 * stop the `FILE` that says it from matching. A folder keeps its single trailing slash.
 *
 * Refused: a backslash (a Windows path leaked into a zip, and a separator on some extractors but
 * not others), a `.` or `..` segment, an absolute path, a drive letter, an empty segment, controls
 * and bidi overrides, an unpaired surrogate, and a name past `MAX_ENTRY_NAME_BYTES`.
 */
export function normaliseEntryName(name: string): string {
	const refuse = (reason: string): never => {
		throw new ValidationError(
			`The archive entry name ${JSON.stringify(name)} is refused: ${reason}`
		);
	};
	if (name === '') return refuse('it is empty');
	if (!name.isWellFormed()) return refuse('it is not valid Unicode');
	if (UTF8_ENCODER.encode(name).length > MAX_ENTRY_NAME_BYTES) return refuse('it is too long');
	if (FORBIDDEN_CHARACTERS.test(name)) return refuse('it contains a control character');
	if (name.includes('\\')) return refuse('it contains a backslash');
	if (name.startsWith('/')) return refuse('it is an absolute path');
	if (DRIVE_LETTER.test(name)) return refuse('it starts with a drive letter');

	const segments = (name.endsWith('/') ? name.slice(0, -1) : name).split('/');
	for (const segment of segments) {
		if (segment === '') return refuse('it has an empty path segment');
		if (segment === '.' || segment === '..') return refuse('it has a relative path segment');
	}
	return name;
}

export interface IndexedEntries {
	/** Canonical name to the name as stored; the same string today, kept apart so a later change to the canonical form needs no caller change. */
	names: Map<string, string>;
	/** Entries whose names were refused, with the reason, for the job report. */
	rejected: Array<{ name: string; reason: string }>;
	/** Groups of names that differ only in case. Legal in a zip, but one file on a case-folding disk. */
	caseCollisions: string[][];
}

/**
 * Checks every entry name of an archive. An exact duplicate is refused for the whole archive: two
 * entries of one name let a scanner and an extractor see different bytes. Case-only duplicates are
 * reported rather than refused, because 7.0 and R2 treat them as different files.
 */
export function indexEntryNames(names: Iterable<string>): IndexedEntries {
	const indexed = new Map<string, string>();
	const rejected: IndexedEntries['rejected'] = [];
	const folded = new Map<string, string[]>();
	for (const name of names) {
		let canonical: string;
		try {
			canonical = normaliseEntryName(name);
		} catch (error) {
			if (!(error instanceof ValidationError)) throw error;
			rejected.push({ name, reason: error.message });
			continue;
		}
		if (indexed.has(canonical)) {
			throw new ValidationError(`The archive has two entries named ${JSON.stringify(canonical)}`);
		}
		indexed.set(canonical, name);
		const key = canonical.toLowerCase();
		folded.set(key, [...(folded.get(key) ?? []), canonical]);
	}
	const caseCollisions = [...folded.values()].filter((group) => group.length > 1);
	return { names: indexed, rejected, caseCollisions };
}

/**
 * Names the 7.0 specification sets aside: the dataset, the optional manifest and the `META-INF/`
 * folder. They are part of the container, never media, even when a `FILE` names one.
 */
export function isReservedEntryName(name: string): boolean {
	return name === 'gedcom.ged' || name === 'MANIFEST.MF' || name.startsWith('META-INF/');
}

export type FileReference =
	| { kind: 'entry'; name: string }
	| { kind: 'external'; url: string }
	| { kind: 'local-path' }
	| { kind: 'missing' };

const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;

/**
 * Decodes `%XX` escapes as UTF-8. Returns null when an escape is malformed or the bytes are not
 * UTF-8, in which case the payload is not a valid reference and names no entry.
 */
function percentDecode(text: string): string | null {
	if (!text.includes('%')) return text;
	if (/%(?![0-9A-Fa-f]{2})/.test(text)) return null;
	try {
		return decodeURIComponent(text);
	} catch {
		return null;
	}
}

/**
 * What a 7.0 `FILE` payload (a URI reference) names. `entries` holds canonical names from
 * `indexEntryNames`.
 *
 * - A reference with an `http:` or `https:` scheme is external: stored as text, never fetched.
 * - Any other scheme (`file:` above all), a network-path (`//host/x`), an absolute path, a drive
 *   letter or a backslash is a path on the author's machine: `local-path`.
 * - Anything else is a relative reference, resolved against the archive root: its query and
 *   fragment are dropped, the rest is percent-decoded, `.` segments are removed as RFC 3986 says,
 *   and the result must pass `normaliseEntryName`, so `..` and its encoded forms never match.
 *   Decoding comes first because `%2e%2e%2f` must be seen as the traversal it is.
 *
 * A reserved name, a folder, or a name no entry has is `missing`: the `FILE` stays unresolved.
 */
export function resolveFileReference(
	filePayload: string,
	entries: ReadonlySet<string>
): FileReference {
	if (filePayload === '') return { kind: 'missing' };
	if (filePayload.includes('\\') || DRIVE_LETTER.test(filePayload)) return { kind: 'local-path' };

	const scheme = SCHEME.exec(filePayload);
	if (scheme) {
		const lower = scheme[1].toLowerCase();
		return lower === 'http' || lower === 'https'
			? { kind: 'external', url: filePayload }
			: { kind: 'local-path' };
	}
	if (filePayload.startsWith('/')) return { kind: 'local-path' };

	const pathEnd = filePayload.search(/[?#]/);
	const rawPath = pathEnd < 0 ? filePayload : filePayload.slice(0, pathEnd);
	const decoded = percentDecode(rawPath);
	if (decoded === null) return { kind: 'missing' };
	// Decoding can reveal a leading slash or drive letter that the raw text did not show.
	if (decoded.startsWith('/') || decoded.includes('\\') || DRIVE_LETTER.test(decoded)) {
		return { kind: 'missing' };
	}

	const segments = decoded.split('/');
	if (segments.length > 1 && segments[segments.length - 1] === '') return { kind: 'missing' };

	let name: string;
	try {
		name = normaliseEntryName(segments.filter((segment) => segment !== '.').join('/'));
	} catch {
		return { kind: 'missing' };
	}
	if (isReservedEntryName(name) || !entries.has(name)) return { kind: 'missing' };
	return { kind: 'entry', name };
}

export type MediaClassification =
	| {
			kind: 'media';
			mime: string;
			/** True for audio, video and transcripts: stored, but never rendered inline. */
			isDownloadOnly: boolean;
			/** The extension for the stored object's key. */
			extension: string;
	  }
	| { kind: 'skipped'; reason: 'reserved' | 'directory' | 'unsupported-type' };

/**
 * Whether an entry becomes a file: everything `UPLOAD_MEDIA_TYPES` accepts plus
 * `GEDZIP_DOWNLOAD_ONLY_TYPES`. A sniffed type, when the caller has read the bytes, outranks the
 * extension; without it the extension gives a provisional answer for the preview. Anything else is
 * `skipped`, and the caller counts it for the job report.
 */
export function classifyMediaEntry(name: string, sniffedMime?: string): MediaClassification {
	if (name.endsWith('/')) return { kind: 'skipped', reason: 'directory' };
	if (isReservedEntryName(name)) return { kind: 'skipped', reason: 'reserved' };

	const mime =
		sniffedMime?.split(';')[0].trim().toLowerCase() ??
		TYPE_BY_EXTENSION[name.slice(name.lastIndexOf('.') + 1).toLowerCase()];
	if (!mime) return { kind: 'skipped', reason: 'unsupported-type' };

	if (isUploadMediaType(mime)) {
		const extension = extensionForMediaType(mime);
		if (extension === null) return { kind: 'skipped', reason: 'unsupported-type' };
		return { kind: 'media', mime, isDownloadOnly: !isInlineMediaType(mime), extension };
	}
	if (isDownloadOnlyType(mime)) {
		return { kind: 'media', mime, isDownloadOnly: true, extension: EXTENSIONS_BY_TYPE[mime] };
	}
	return { kind: 'skipped', reason: 'unsupported-type' };
}
