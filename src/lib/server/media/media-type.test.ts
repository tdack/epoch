import { describe, expect, it } from 'vitest';
import { ValidationError } from '../domain/errors';
import {
	contentDispositionFor,
	inlineDispositionFor,
	safeDownloadName,
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

	it('recognises HEIC brands as image/heic', () => {
		for (const brand of ['heic', 'heix', 'hevc', 'heim', 'heis']) {
			expect(sniffMediaType(bytesOf([0, 0, 0, 0x18], `ftyp${brand}`, [0, 0, 0, 0]))).toBe(
				'image/heic'
			);
		}
	});

	it('treats a bare mif1 or msf1 file as image/heif', () => {
		for (const brand of ['mif1', 'msf1']) {
			expect(sniffMediaType(bytesOf([0, 0, 0, 0x18], `ftyp${brand}`, [0, 0, 0, 0], 'heic'))).toBe(
				'image/heif'
			);
		}
	});

	it('treats a mif1 major brand listing avif as compatible as image/avif', () => {
		expect(sniffMediaType(bytesOf([0, 0, 0, 0x1c], 'ftypmif1', [0, 0, 0, 0], 'miaf', 'avif'))).toBe(
			'image/avif'
		);
	});

	it('does not read compatible brands past the end of the ftyp box', () => {
		expect(sniffMediaType(bytesOf([0, 0, 0, 0x14], 'ftypmif1', [0, 0, 0, 0], 'miaf', 'avif'))).toBe(
			'image/heif'
		);
	});

	it('rejects other ISO-BMFF brands such as video', () => {
		expect(sniffMediaType(bytesOf([0, 0, 0, 0x18], 'ftypisom', [0, 0, 0, 0]))).toBeNull();
	});

	it('accepts HEIC and HEIF uploads with their own extensions', () => {
		expect(validateMediaUpload('', bytesOf([0, 0, 0, 0x18], 'ftypheic', [0, 0, 0, 0]))).toEqual({
			mimeType: 'image/heic',
			extension: 'heic'
		});
		expect(validateMediaUpload('', bytesOf([0, 0, 0, 0x18], 'ftypmif1', [0, 0, 0, 0]))).toEqual({
			mimeType: 'image/heif',
			extension: 'heif'
		});
	});

	it('serves HEIC and HEIF as downloads, never inline', () => {
		const decision = mediaServeDecision('image/heic', 'media/t/abc.heic');
		expect(decision.contentType).toBe('application/octet-stream');
		expect(decision.contentDisposition).toContain('attachment');
	});

	it('recognises PDF at the start', () => {
		expect(sniffMediaType(bytesOf('%PDF-1.7\n'))).toBe('application/pdf');
	});

	it('recognises PDF after a BOM and whitespace', () => {
		expect(sniffMediaType(bytesOf([0xef, 0xbb, 0xbf, 0x20, 0x0d, 0x0a], '%PDF-1.4'))).toBe(
			'application/pdf'
		);
	});

	it('does not accept %PDF- after other content (polyglot)', () => {
		expect(sniffMediaType(bytesOf('<html>', '%PDF-1.4'))).toBeNull();
		expect(sniffMediaType(bytesOf(new Array<number>(100).fill(0xef), '%PDF-1.4'))).toBeNull();
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
			contentDisposition: 'inline',
			shouldSandbox: true
		});
	});

	it('serves PDFs inline, named after the title, unsandboxed', () => {
		expect(mediaServeDecision('application/pdf', 'media/t/1/x.pdf', 'Will.docx')).toEqual({
			contentType: 'application/pdf',
			contentDisposition: 'inline; filename="Will.pdf"; filename*=UTF-8\'\'Will.pdf',
			shouldSandbox: false
		});
		expect(mediaServeDecision('image/png', 'k').shouldSandbox).toBe(true);
		expect(mediaServeDecision(undefined, 'k').shouldSandbox).toBe(true);
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
			contentDisposition: 'attachment; filename="mystery"',
			shouldSandbox: true
		});
	});
});

describe('safeDownloadName and inlineDispositionFor', () => {
	it('keeps only the last path segment', () => {
		expect(safeDownloadName('../../etc/passwd', 'pdf')).toBe('passwd.pdf');
		expect(safeDownloadName('..\\x', 'pdf')).toBe('x.pdf');
		expect(safeDownloadName('..', 'pdf')).toBe('download.pdf');
	});

	it('strips CR, LF, quotes and separators so no header can be injected', () => {
		const header = inlineDispositionFor('a"\r\nX-Evil: 1;.pdf', 'pdf');
		expect(header).not.toMatch(/[\r\n]/);
		expect(header).toBe('inline; filename="a X-Evil 1.pdf"; filename*=UTF-8\'\'a%20X-Evil%201.pdf');
	});

	it('strips leading dots, collapses whitespace and swaps the extension', () => {
		expect(safeDownloadName('.hidden   file.docx', 'pdf')).toBe('hidden file.pdf');
		expect(safeDownloadName('report', 'pdf')).toBe('report.pdf');
	});

	it('falls back for empty or null titles', () => {
		expect(safeDownloadName('', 'pdf')).toBe('download.pdf');
		expect(safeDownloadName(null, 'pdf')).toBe('download.pdf');
		expect(safeDownloadName('"";', 'pdf')).toBe('download.pdf');
	});

	it('caps the length', () => {
		expect(safeDownloadName('x'.repeat(500), 'pdf')).toBe(`${'x'.repeat(100)}.pdf`);
	});

	it('survives non-ASCII titles through filename*', () => {
		expect(inlineDispositionFor('Zoë 日本.pdf', 'pdf')).toBe(
			`inline; filename="Zo_ __.pdf"; filename*=UTF-8''Zo%C3%AB%20%E6%97%A5%E6%9C%AC.pdf`
		);
	});
});
