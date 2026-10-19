/**
 * Server-side media type decisions: what a file actually is (from its bytes, never its name or
 * declared type) and how a stored object is safe to serve. Pure and DB-free so both routes and
 * tests can call it directly.
 */

import { PayloadTooLargeError, ValidationError } from '../domain/errors';
import {
	extensionForMediaType,
	isInlineMediaType,
	isUploadMediaType,
	MAX_MEDIA_UPLOAD_BYTES
} from '../../shared/media';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const PDF_MAGIC = '%PDF-';
/** PDF can carry leading bytes; see the matching code below. */
const PDF_SEARCH_WINDOW = 1024;

function startsWithBytes(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
	if (bytes.length < offset + signature.length) return false;
	for (let i = 0; i < signature.length; i++) {
		if (bytes[offset + i] !== signature[i]) return false;
	}
	return true;
}

function matchesAscii(bytes: Uint8Array, text: string, offset = 0): boolean {
	if (bytes.length < offset + text.length) return false;
	for (let i = 0; i < text.length; i++) {
		if (bytes[offset + i] !== text.charCodeAt(i)) return false;
	}
	return true;
}

const AVIF_BRANDS = ['avif', 'avis'];
const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'heim', 'heis'];
/** Generic image-sequence brands: the file is HEIF, or AVIF if `avif` is also listed as compatible. */
const HEIF_GENERIC_BRANDS = ['mif1', 'msf1'];
/** How many compatible brands to read; real files list a handful, so this only bounds the loop. */
const MAX_COMPATIBLE_BRANDS = 32;

function brandAt(bytes: Uint8Array, offset: number): string | null {
	if (bytes.length < offset + 4) return null;
	return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

/**
 * Read the `ftyp` box: a major brand at 8, a minor version at 12, then compatible brands to the end
 * of the box. A `mif1` major brand says only "HEIF structure", so AVIF is told apart by `avif`
 * among the compatible brands.
 */
function sniffIsoBmffImage(bytes: Uint8Array): string | null {
	if (!matchesAscii(bytes, 'ftyp', 4)) return null;
	const major = brandAt(bytes, 8);
	if (major === null) return null;
	if (AVIF_BRANDS.includes(major)) return 'image/avif';
	if (HEIC_BRANDS.includes(major)) return 'image/heic';
	if (!HEIF_GENERIC_BRANDS.includes(major)) return null;

	const boxEnd = Math.min(
		bytes.length,
		((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0
	);
	for (
		let i = 0, offset = 16;
		i < MAX_COMPATIBLE_BRANDS && offset + 4 <= boxEnd;
		i++, offset += 4
	) {
		if (AVIF_BRANDS.includes(brandAt(bytes, offset) ?? '')) return 'image/avif';
	}
	return 'image/heif';
}

/**
 * Identify a file from its magic bytes alone, returning null when nothing matches. The declared
 * type and filename are attacker-controlled, so they never participate.
 */
export function sniffMediaType(bytes: Uint8Array): string | null {
	if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
	if (startsWithBytes(bytes, PNG_SIGNATURE)) return 'image/png';
	if (matchesAscii(bytes, 'GIF87a') || matchesAscii(bytes, 'GIF89a')) return 'image/gif';
	if (matchesAscii(bytes, 'RIFF') && matchesAscii(bytes, 'WEBP', 8)) return 'image/webp';
	const isoImageType = sniffIsoBmffImage(bytes);
	if (isoImageType) return isoImageType;

	// A PDF may carry a byte-order mark or leading whitespace, so its magic is searched, not assumed first.
	const limit = Math.min(bytes.length, PDF_SEARCH_WINDOW);
	for (let i = 0; i + PDF_MAGIC.length <= limit; i++) {
		if (matchesAscii(bytes, PDF_MAGIC, i)) return 'application/pdf';
	}

	return null;
}

/**
 * Decide an upload's type from its bytes. Throws when the bytes are not a supported type; a
 * `text/html` or `image/svg+xml` payload thus fails here rather than being served later.
 */
export function validateMediaUpload(
	declaredType: string,
	bytes: Uint8Array
): { mimeType: string; extension: string } {
	const sniffed = sniffMediaType(bytes);
	if (!sniffed || !isUploadMediaType(sniffed)) {
		throw new ValidationError(`Unsupported media type: ${declaredType || 'unknown'}`);
	}
	const extension = extensionForMediaType(sniffed);
	if (!extension) {
		// Only reachable if the sniff and accept lists drift apart.
		throw new ValidationError(`No extension for media type: ${sniffed}`);
	}
	return { mimeType: sniffed, extension };
}

/**
 * Backstop for a body whose size could not be known before parsing: a chunked request carries no
 * `Content-Length`, so the route checks the parsed file size here as well.
 */
export function assertUploadWithinSizeLimit(size: number): void {
	if (size > MAX_MEDIA_UPLOAD_BYTES) {
		throw new PayloadTooLargeError(`Upload exceeds the ${MAX_MEDIA_UPLOAD_BYTES} byte limit`);
	}
}

/**
 * A download filename header built from an object key, reduced to characters safe in a header. The
 * replacement drops CR, LF and quotes as well, so no header can be injected through the key.
 */
export function contentDispositionFor(objectKey: string): string {
	const base = objectKey.split('/').pop() ?? '';
	const safe = base.replace(/[^a-zA-Z0-9_-]/g, '_') || 'download';
	return `attachment; filename="${safe}"`;
}

/**
 * How to serve a stored object, decided from an allowlist rather than the stored type. Raster
 * images render inline; PDFs and everything else (including `text/html`, `image/svg+xml` and a
 * missing type) download as an opaque octet stream so a browser never executes them on our origin.
 */
export function mediaServeDecision(
	storedType: string | undefined,
	objectKey: string
): { contentType: string; contentDisposition: string } {
	if (isInlineMediaType(storedType)) {
		return { contentType: storedType, contentDisposition: 'inline' };
	}
	if (storedType === 'application/pdf') {
		return { contentType: 'application/pdf', contentDisposition: 'attachment' };
	}
	return {
		contentType: 'application/octet-stream',
		contentDisposition: contentDispositionFor(objectKey)
	};
}
