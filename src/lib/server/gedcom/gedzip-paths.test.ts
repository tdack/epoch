import { describe, expect, it } from 'vitest';
import { ValidationError } from '../domain/errors';
import {
	classifyMediaEntry,
	GEDZIP_DOWNLOAD_ONLY_TYPES,
	indexEntryNames,
	isReservedEntryName,
	MAX_ENTRY_NAME_BYTES,
	normaliseEntryName,
	resolveFileReference
} from './gedzip-paths';
import { readCentralDirectory } from './zip-reader';

// @ts-expect-error @types/node is not installed; the fixtures are binary, so they are read here.
const { existsSync, readFileSync } = await import('node:fs');

describe('normaliseEntryName', () => {
	it.each([
		'gedcom.ged',
		'media/photo.jpg',
		'media/',
		'a b/c d.png',
		'media/CharlotteBrontë.jpg',
		'日本/写真.jpg',
		'a%20b.jpg',
		'.hidden',
		'a..b/c',
		'path/to/file1'
	])('keeps %s as it is', (name) => {
		expect(normaliseEntryName(name)).toBe(name);
	});

	it.each([
		['', 'empty'],
		['../x', 'parent segment'],
		['a/../b', 'inner parent segment'],
		['a/..', 'trailing parent segment'],
		['./a', 'current-directory segment'],
		['a/./b', 'inner current-directory segment'],
		['/etc/passwd', 'absolute path'],
		['C:/x.jpg', 'drive letter'],
		['c:x.jpg', 'drive letter without slash'],
		['a\\b.jpg', 'backslash'],
		['..\\x', 'backslash traversal'],
		['a//b', 'empty segment'],
		['a/b//', 'doubled trailing slash'],
		['//', 'only slashes'],
		['a\u0000b', 'NUL'],
		['a\nb', 'newline'],
		['a\u007fb', 'DEL'],
		['a\u0085b', 'C1 control'],
		['a\u202eb', 'bidi override'],
		['a\ud800b', 'lone surrogate'],
		['a'.repeat(MAX_ENTRY_NAME_BYTES + 1), 'too long'],
		['é'.repeat(MAX_ENTRY_NAME_BYTES / 2 + 1), 'too long in bytes']
	])('refuses %j (%s)', (name) => {
		expect(() => normaliseEntryName(name)).toThrow(ValidationError);
	});

	it('accepts a name of exactly the cap', () => {
		const name = 'a'.repeat(MAX_ENTRY_NAME_BYTES);
		expect(normaliseEntryName(name)).toBe(name);
	});
});

describe('indexEntryNames', () => {
	it('indexes good names and reports the refused ones', () => {
		const { names, rejected, caseCollisions } = indexEntryNames([
			'gedcom.ged',
			'media/a.jpg',
			'../evil',
			'/abs',
			'x\\y'
		]);
		expect([...names.keys()]).toEqual(['gedcom.ged', 'media/a.jpg']);
		expect(rejected.map((entry) => entry.name)).toEqual(['../evil', '/abs', 'x\\y']);
		expect(caseCollisions).toEqual([]);
	});

	it('refuses an archive with two entries of one name', () => {
		expect(() => indexEntryNames(['a.jpg', 'b.jpg', 'a.jpg'])).toThrow(/two entries/);
	});

	it('keeps case-only twins as separate files and reports them', () => {
		const { names, caseCollisions } = indexEntryNames([
			'media/A.jpg',
			'media/a.jpg',
			'media/b.jpg'
		]);
		expect(names.size).toBe(3);
		expect(caseCollisions).toEqual([['media/A.jpg', 'media/a.jpg']]);
	});
});

describe('resolveFileReference, with the official filename-1.ged payloads', () => {
	const entries = new Set([
		'gedcom.ged',
		'MANIFEST.MF',
		'META-INF/example',
		'a/relative/path',
		'most/paths?get#escaped[like]this',
		'media/Charlotte Brontë 2.jpg',
		'media/'
	]);
	const resolve = (payload: string) => resolveFileReference(payload, entries);

	it('treats file: URIs as paths on the author machine', () => {
		expect(resolve('file:///unix/absolute')).toEqual({ kind: 'local-path' });
		expect(resolve('file:///c:/windows/absolute')).toEqual({ kind: 'local-path' });
		expect(resolve('file://host.example.com/server')).toEqual({ kind: 'local-path' });
		expect(resolve('FILE:///x')).toEqual({ kind: 'local-path' });
	});

	it('resolves a relative reference against the archive root', () => {
		expect(resolve('a/relative/path')).toEqual({ kind: 'entry', name: 'a/relative/path' });
		expect(resolve('./a/relative/path')).toEqual({ kind: 'entry', name: 'a/relative/path' });
		expect(resolve('a/./relative/path')).toEqual({ kind: 'entry', name: 'a/relative/path' });
	});

	it('percent-decodes a relative reference once', () => {
		expect(resolve('most/paths%3Fget%23escaped%5Blike%5Dthis')).toEqual({
			kind: 'entry',
			name: 'most/paths?get#escaped[like]this'
		});
		expect(resolve('media/Charlotte%20Bront%C3%AB%202.jpg')).toEqual({
			kind: 'entry',
			name: 'media/Charlotte Brontë 2.jpg'
		});
	});

	it('does not decode twice', () => {
		const twice = new Set(['a%20b']);
		expect(resolveFileReference('a%2520b', twice)).toEqual({ kind: 'entry', name: 'a%20b' });
		expect(resolveFileReference('a%20b', twice)).toEqual({ kind: 'missing' });
	});

	it('does not take an escaped scheme for a URL', () => {
		expect(resolve('https%3a//not.a.url/even-though-similar')).toEqual({ kind: 'missing' });
	});

	it('treats web URLs as external, whatever their query, fragment or characters', () => {
		for (const url of [
			'https://host.example.com?with=args#and-frags',
			'https://upload.wikimedia.org/wikipedia/commons/1/16/Charlotte_Brontë_2.jpg',
			'https://upload.wikimedia.org/wikipedia/commons/1/16/Charlotte_Bront%C3%AB_2.jpg',
			'http://host.example.com/path/to/file2',
			'HTTPS://HOST.EXAMPLE.COM/A'
		]) {
			expect(resolve(url)).toEqual({ kind: 'external', url });
		}
	});

	it('never matches the reserved names', () => {
		expect(resolve('gedcom.ged')).toEqual({ kind: 'missing' });
		expect(resolve('MANIFEST.MF')).toEqual({ kind: 'missing' });
		expect(resolve('META-INF/example')).toEqual({ kind: 'missing' });
		expect(resolve('META-INF%2Fexample')).toEqual({ kind: 'missing' });
		expect(resolve('./gedcom.ged')).toEqual({ kind: 'missing' });
	});

	it('is missing when no entry has the name, or the entry is a folder', () => {
		expect(resolve('nothing/here.jpg')).toEqual({ kind: 'missing' });
		expect(resolve('media/')).toEqual({ kind: 'missing' });
		expect(resolve('')).toEqual({ kind: 'missing' });
		expect(resolve('A/relative/path')).toEqual({ kind: 'missing' });
	});

	it('drops a query or fragment on a relative reference', () => {
		expect(resolve('a/relative/path?v=2#top')).toEqual({ kind: 'entry', name: 'a/relative/path' });
	});

	it('is missing on a malformed escape rather than throwing', () => {
		expect(resolve('a/%zz')).toEqual({ kind: 'missing' });
		expect(resolve('a/%')).toEqual({ kind: 'missing' });
		expect(resolve('a/%FF')).toEqual({ kind: 'missing' });
	});

	it('treats absolute paths, drive letters and backslashes as local paths', () => {
		expect(resolve('/unix/absolute')).toEqual({ kind: 'local-path' });
		expect(resolve('//host/share/x.jpg')).toEqual({ kind: 'local-path' });
		expect(resolve('C:\\Photos\\a.jpg')).toEqual({ kind: 'local-path' });
		expect(resolve('C:/Photos/a.jpg')).toEqual({ kind: 'local-path' });
		expect(resolve('media\\a.jpg')).toEqual({ kind: 'local-path' });
		expect(resolve('data:image/png;base64,AAAA')).toEqual({ kind: 'local-path' });
	});
});

describe('resolveFileReference against traversal', () => {
	// Entries are what a hostile archive might hold. Even if one is listed, no reference reaches it.
	const entries = new Set(['evil', 'etc/passwd', 'a/b', '..', 'a/..', 'c:/x']);
	it.each([
		'../evil',
		'a/../evil',
		'a/../../evil',
		'..',
		'%2e%2e/evil',
		'%2E%2E%2Fevil',
		'a/%2e%2e/evil',
		'a%2f..%2fevil',
		'..%5Cevil',
		'a%5Cb',
		'%2Fetc/passwd',
		'/etc/passwd',
		'%00evil',
		'a%00',
		'%43%3a/x',
		'a//b'
	])('%s resolves to no entry', (payload) => {
		expect(resolveFileReference(payload, entries).kind).not.toBe('entry');
	});
});

describe('isReservedEntryName', () => {
	it('names the container files only', () => {
		expect(isReservedEntryName('gedcom.ged')).toBe(true);
		expect(isReservedEntryName('MANIFEST.MF')).toBe(true);
		expect(isReservedEntryName('META-INF/')).toBe(true);
		expect(isReservedEntryName('META-INF/anything')).toBe(true);
		expect(isReservedEntryName('media/gedcom.ged')).toBe(false);
		expect(isReservedEntryName('META-INFO.jpg')).toBe(false);
	});
});

describe('classifyMediaEntry', () => {
	it('accepts every upload type by extension', () => {
		expect(classifyMediaEntry('media/a.jpg')).toEqual({
			kind: 'media',
			mime: 'image/jpeg',
			isDownloadOnly: false,
			extension: 'jpg'
		});
		expect(classifyMediaEntry('b.PNG')).toMatchObject({ kind: 'media', mime: 'image/png' });
		expect(classifyMediaEntry('c.pdf')).toMatchObject({ isDownloadOnly: true });
		expect(classifyMediaEntry('d.heic')).toMatchObject({
			mime: 'image/heic',
			isDownloadOnly: true
		});
	});

	it('accepts the download-only audio, video and transcript types', () => {
		expect(classifyMediaEntry('media/original.mp3')).toEqual({
			kind: 'media',
			mime: 'audio/mpeg',
			isDownloadOnly: true,
			extension: 'mp3'
		});
		expect(classifyMediaEntry('media/derived.oga')).toMatchObject({ mime: 'audio/ogg' });
		expect(classifyMediaEntry('media/transcript.vtt')).toMatchObject({
			mime: 'text/vtt',
			isDownloadOnly: true,
			extension: 'vtt'
		});
		expect(classifyMediaEntry('v.mp4')).toMatchObject({ mime: 'video/mp4' });
	});

	it('gives every download-only type an extension and never calls it inline', () => {
		for (const mime of GEDZIP_DOWNLOAD_ONLY_TYPES) {
			expect(classifyMediaEntry('x', mime)).toMatchObject({
				kind: 'media',
				isDownloadOnly: true,
				extension: expect.stringMatching(/^[a-z0-9]+$/)
			});
		}
	});

	it('lets a sniffed type outrank the extension', () => {
		expect(classifyMediaEntry('photo.jpg', 'image/png')).toMatchObject({ mime: 'image/png' });
		expect(classifyMediaEntry('photo.jpg', 'text/html')).toEqual({
			kind: 'skipped',
			reason: 'unsupported-type'
		});
		expect(classifyMediaEntry('x.bin', 'Image/JPEG; charset=binary')).toMatchObject({
			mime: 'image/jpeg'
		});
	});

	it('skips what is not media, and says why', () => {
		expect(classifyMediaEntry('script.js')).toEqual({
			kind: 'skipped',
			reason: 'unsupported-type'
		});
		expect(classifyMediaEntry('noextension')).toEqual({
			kind: 'skipped',
			reason: 'unsupported-type'
		});
		expect(classifyMediaEntry('vector.svg')).toEqual({
			kind: 'skipped',
			reason: 'unsupported-type'
		});
		expect(classifyMediaEntry('page.html')).toEqual({
			kind: 'skipped',
			reason: 'unsupported-type'
		});
		expect(classifyMediaEntry('media/')).toEqual({ kind: 'skipped', reason: 'directory' });
		expect(classifyMediaEntry('gedcom.ged')).toEqual({ kind: 'skipped', reason: 'reserved' });
		expect(classifyMediaEntry('META-INF/x.jpg')).toEqual({ kind: 'skipped', reason: 'reserved' });
		expect(classifyMediaEntry('path/to/file1')).toEqual({
			kind: 'skipped',
			reason: 'unsupported-type'
		});
	});
});

describe('the official maximal70.gdz', () => {
	const folder = new URL('./fixtures/conformance/files/', import.meta.url);
	const archive = new URL('maximal70.gdz', folder);
	const dataset = new URL('maximal70.ged', folder);

	// Fetched by `npm run gedcom:conformance` and gitignored, so a fresh clone skips.
	describe.skipIf(!existsSync(archive) || !existsSync(dataset))('when fetched', () => {
		it('matches its FILE payloads to its entries', async () => {
			const bytes = new Uint8Array(readFileSync(archive));
			const directory = await readCentralDirectory({
				size: bytes.length,
				readRange: async (offset, length) => bytes.slice(offset, offset + length),
				readStream: async () => {
					throw new Error('not needed');
				}
			});
			const { names, rejected, caseCollisions } = indexEntryNames(
				directory.entries.map((entry) => entry.name)
			);
			expect(rejected).toEqual([]);
			expect(caseCollisions).toEqual([]);
			const set = new Set(names.keys());
			const files = [...readFileSync(dataset, 'utf8').matchAll(/^\d+ FILE (.*)$/gm)].map(
				(match) => match[1]
			);

			const results = files.map((payload) => resolveFileReference(payload, set));
			expect(results).toEqual([
				{ kind: 'entry', name: 'media/CharlotteBrontë.jpg' },
				{ kind: 'local-path' },
				{ kind: 'entry', name: 'media/original.mp3' },
				{ kind: 'external', url: 'http://host.example.com/path/to/file2' },
				{ kind: 'external', url: 'http://host.example.com/path/to/file3' }
			]);

			// Of the archive's files, the dataset names two; the rest are what an unreferenced entry
			// looks like to the importer (ADR-082, owner decision 4).
			const classified = Object.groupBy(
				directory.entries.map((entry) => entry.name),
				(name) => {
					const result = classifyMediaEntry(name);
					return result.kind === 'media' ? 'media' : result.reason;
				}
			);
			expect(classified.media).toEqual([
				'media/CharlotteBrontë.jpg',
				'media/derived.oga',
				'media/original.mp3',
				'media/transcript.vtt'
			]);
			expect(classified.reserved).toEqual(['gedcom.ged']);
			expect(classified.directory).toEqual(['media/', 'path/', 'path/to/']);
			expect(classified['unsupported-type']).toEqual(['path/to/file1']);
		});
	});
});
