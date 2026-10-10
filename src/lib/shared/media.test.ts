import { describe, expect, it } from 'vitest';
import {
	extensionForMediaType,
	INLINE_MEDIA_TYPES,
	isInlineMediaType,
	isUploadMediaType,
	MEDIA_UPLOAD_ACCEPT,
	UPLOAD_MEDIA_TYPES
} from './media';

describe('inline media allowlist', () => {
	it('accepts the raster formats it lists', () => {
		for (const mime of INLINE_MEDIA_TYPES) {
			expect(isInlineMediaType(mime)).toBe(true);
		}
	});

	it('rejects script-bearing types that a prefix check would admit', () => {
		expect(isInlineMediaType('image/svg+xml')).toBe(false);
		expect(isInlineMediaType('text/html')).toBe(false);
		expect(isInlineMediaType('image/svg+xml; charset=utf-8')).toBe(false);
	});

	it('rejects missing and unrelated types', () => {
		expect(isInlineMediaType(undefined)).toBe(false);
		expect(isInlineMediaType(null)).toBe(false);
		expect(isInlineMediaType('')).toBe(false);
		expect(isInlineMediaType('application/pdf')).toBe(false);
	});
});

describe('upload allowlist', () => {
	it('confines inline types plus PDF', () => {
		for (const mime of UPLOAD_MEDIA_TYPES) {
			expect(isUploadMediaType(mime)).toBe(true);
		}
		expect(isUploadMediaType('image/svg+xml')).toBe(false);
		expect(isUploadMediaType('text/html')).toBe(false);
	});

	it('builds the accept attribute from the allowlist', () => {
		expect(MEDIA_UPLOAD_ACCEPT).toBe(UPLOAD_MEDIA_TYPES.join(','));
		expect(MEDIA_UPLOAD_ACCEPT).not.toContain('svg');
	});
});

describe('extensionForMediaType', () => {
	it('maps jpeg to jpg and the rest to their short names', () => {
		expect(extensionForMediaType('image/jpeg')).toBe('jpg');
		expect(extensionForMediaType('image/png')).toBe('png');
		expect(extensionForMediaType('image/gif')).toBe('gif');
		expect(extensionForMediaType('image/webp')).toBe('webp');
		expect(extensionForMediaType('image/avif')).toBe('avif');
		expect(extensionForMediaType('application/pdf')).toBe('pdf');
	});

	it('returns null for anything else', () => {
		expect(extensionForMediaType('text/html')).toBeNull();
		expect(extensionForMediaType('image/svg+xml')).toBeNull();
	});
});
