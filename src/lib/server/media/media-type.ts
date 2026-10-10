/**
 * Server-side media type decisions: what a file actually is (from its bytes, never its name or
 * declared type) and how a stored object is safe to serve. Pure and DB-free so both routes and
 * tests can call it directly.
 */

import { ValidationError } from '../domain/errors';
import { extensionForMediaType, isInlineMediaType, isUploadMediaType } from '../../shared/media';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const PDF_MAGIC = '%PDF-';
/** ISO-BMFF (AVIF) and PDF can carry leading bytes; see the matching code below. */
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

/**
 * Identify a file from its magic bytes alone, returning null when nothing matches. The declared
 * type and filename are attacker-controlled, so they never participate.
 */
export function sniffMediaType(bytes: Uint8Array): string | null {
	if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
	if (startsWithBytes(bytes, PNG_SIGNATURE)) return 'image/png';
	if (matchesAscii(bytes, 'GIF87a') || matchesAscii(bytes, 'GIF89a')) return 'image/gif';
	if (matchesAscii(bytes, 'RIFF') && matchesAscii(bytes, 'WEBP', 8)) return 'image/webp';
	if (
		matchesAscii(bytes, 'ftyp', 4) &&
		(matchesAscii(bytes, 'avif', 8) || matchesAscii(bytes, 'avis', 8))
	)
		return 'image/avif';

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
