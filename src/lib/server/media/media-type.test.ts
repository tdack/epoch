import { describe, expect, it } from 'vitest';
import { ValidationError } from '../domain/errors';
import {
	contentDispositionFor,
	mediaServeDecision,
	sniffMediaType,
	validateMediaUpload
} from './media-type';

/** Build a byte array from numbers and ASCII strings, for readable magic-byte fixtures. */
function bytesOf(...parts: Array<number[] | string>): Uint8Array {
	const out: number[] = [];
	for (const part of parts) {
		if (typeof part === 'string') {
			for (const char of part) out.push(char.charCodeAt(0));
		} else {
			out.push(...part);
		}
	}
	return new Uint8Array(out);
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe('sniffMediaType', () => {
	it('recognises JPEG', () => {
		expect(sniffMediaType(bytesOf([0xff, 0xd8, 0xff, 0xe0], 'JFIF', [0]))).toBe('image/jpeg');
	});

	it('recognises PNG', () => {
		expect(sniffMediaType(bytesOf(PNG_SIGNATURE, [0, 0, 0, 13], 'IHDR'))).toBe('image/png');
	});

	it('recognises both GIF signatures', () => {
		expect(sniffMediaType(bytesOf('GIF87a', [0, 1, 2]))).toBe('image/gif');
		expect(sniffMediaType(bytesOf('GIF89a', [0, 1, 2]))).toBe('image/gif');
	});

	it('recognises WEBP (RIFF with the WEBP tag at offset 8)', () => {
		expect(sniffMediaType(bytesOf('RIFF', [0x1c, 0, 0, 0], 'WEBP', 'VP8 '))).toBe('image/webp');
		// A RIFF container that is not WEBP (e.g. WAV) is unknown.
		expect(sniffMediaType(bytesOf('RIFF', [0x1c, 0, 0, 0], 'WAVE'))).toBeNull();
	});

	it('recognises AVIF and AVIS brands', () => {
		expect(sniffMediaType(bytesOf([0, 0, 0, 0x20], 'ftypavif'))).toBe('image/avif');
		expect(sniffMediaType(bytesOf([0, 0, 0, 0x20], 'ftypavis'))).toBe('image/avif');
	});

	it('recognises PDF at the start', () => {
		expect(sniffMediaType(bytesOf('%PDF-1.7\n'))).toBe('application/pdf');
	});

	it('recognises PDF after leading bytes within the search window', () => {
		const leading = new Array<number>(100).fill(0xef);
		expect(sniffMediaType(bytesOf(leading, '%PDF-1.4'))).toBe('application/pdf');
	});

	it('does not look for PDF past the search window', () => {
		const leading = new Array<number>(1100).fill(0xef);
		expect(sniffMediaType(bytesOf(leading, '%PDF-1.4'))).toBeNull();
	});

	it('returns null for truncated, empty and garbage input', () => {
		expect(sniffMediaType(new Uint8Array())).toBeNull();
		expect(sniffMediaType(bytesOf([0xff, 0xd8]))).toBeNull();
		expect(sniffMediaType(bytesOf(PNG_SIGNATURE.slice(0, 7)))).toBeNull();
		expect(sniffMediaType(bytesOf('not a real file'))).toBeNull();
	});

	it('trusts bytes over content: a PNG + HTML polyglot is a PNG', () => {
		const polyglot = bytesOf(PNG_SIGNATURE, '<html><script>alert(1)</script>');
		expect(sniffMediaType(polyglot)).toBe('image/png');
	});
});

describe('validateMediaUpload', () => {
	it('decides from the bytes, not the declared type', () => {
		// A lying declared type on a real PNG is still stored as a PNG.
		expect(validateMediaUpload('text/html', bytesOf(PNG_SIGNATURE, [0, 1]))).toEqual({
			mimeType: 'image/png',
			extension: 'png'
		});
		// A real PDF keeps its extension.
		expect(validateMediaUpload('image/jpeg', bytesOf('%PDF-1.7'))).toEqual({
			mimeType: 'application/pdf',
			extension: 'pdf'
		});
	});

	it('accepts a PNG + HTML polyglot as a PNG', () => {
		const polyglot = bytesOf(PNG_SIGNATURE, '<html><script>alert(1)</script>');
		expect(validateMediaUpload('image/png', polyglot)).toEqual({
			mimeType: 'image/png',
			extension: 'png'
		});
	});

	it('rejects HTML bytes', () => {
		expect(() => validateMediaUpload('text/html', bytesOf('<html><body>hi'))).toThrow(
			ValidationError
		);
	});

	it('rejects SVG bytes', () => {
		expect(() =>
			validateMediaUpload('image/svg+xml', bytesOf('<svg xmlns="http://www.w3.org/2000/svg">'))
		).toThrow(ValidationError);
	});
});

describe('contentDispositionFor', () => {
	it('keeps a safe basename and drops CR, LF, quotes and backslashes', () => {
		expect(contentDispositionFor('media/t/1/photo.png')).toBe('attachment; filename="photo_png"');
		const nasty = contentDispositionFor('media/t/1/a"\r\nX-Evil: 1.png');
		expect(nasty).toBe('attachment; filename="a___X-Evil__1_png"');
		// The only quotes are the delimiters; no CR or LF survives into the header.
		expect(nasty).not.toMatch(/[\r\n]/);
	});

	it('falls back to a placeholder for an empty name', () => {
		expect(contentDispositionFor('media/t/1/')).toBe('attachment; filename="download"');
	});
});

describe('mediaServeDecision', () => {
	it('serves raster images inline as themselves', () => {
		expect(mediaServeDecision('image/png', 'media/t/1/x.png')).toEqual({
			contentType: 'image/png',
			contentDisposition: 'inline'
		});
	});

	it('downloads PDFs as attachments', () => {
		expect(mediaServeDecision('application/pdf', 'media/t/1/x.pdf')).toEqual({
			contentType: 'application/pdf',
			contentDisposition: 'attachment'
		});
	});

	it('serves a legacy HTML or SVG object as an opaque attachment', () => {
		for (const stored of ['text/html', 'image/svg+xml']) {
			const decision = mediaServeDecision(stored, 'media/t/1/x.bin');
			expect(decision.contentType).toBe('application/octet-stream');
			expect(decision.contentDisposition).toBe('attachment; filename="x_bin"');
		}
	});

	it('serves an object with no stored type as an opaque attachment', () => {
		expect(mediaServeDecision(undefined, 'media/t/1/mystery')).toEqual({
			contentType: 'application/octet-stream',
			contentDisposition: 'attachment; filename="mystery"'
		});
	});
});
