import { deflateSync, strToU8, Zip, ZipDeflate, ZipPassThrough, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { PayloadTooLargeError, ValidationError } from '../domain/errors';
import { MAX_TREE_MEDIA_BYTES } from '../../shared/media';
import { crc32 } from './crc32';
import {
	MAX_DATASET_BYTES,
	MAX_GEDZIP_UNCOMPRESSED_BYTES,
	MAX_GEDZIP_UPLOAD_BYTES
} from './limits';
import {
	openEntry,
	r2ZipSource,
	readCentralDirectory,
	type ZipEntry,
	type ZipLimits,
	type ZipSource
} from './zip-reader';

// @ts-expect-error @types/node is not installed; the fixtures are binary, so they are read here.
const { existsSync, readFileSync } = await import('node:fs');

/** A source over a buffer that hands streams out in small chunks, as R2 would. */
function memorySource(bytes: Uint8Array, chunkBytes = 1000): ZipSource {
	return {
		size: bytes.length,
		async readRange(offset, length) {
			return bytes.slice(offset, offset + length);
		},
		async readStream(offset, length) {
			const slice = bytes.slice(offset, offset + length);
			let at = 0;
			return new ReadableStream({
				pull(controller) {
					if (at >= slice.length) return controller.close();
					controller.enqueue(slice.slice(at, at + chunkBytes));
					at += chunkBytes;
				}
			});
		}
	};
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
	const chunks: Uint8Array[] = [];
	const reader = stream.getReader();
	for (;;) {
		const { done: isDone, value } = await reader.read();
		if (isDone) break;
		chunks.push(value);
	}
	const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
	let at = 0;
	for (const chunk of chunks) {
		out.set(chunk, at);
		at += chunk.length;
	}
	return out;
}

interface TestEntry {
	name: string | Uint8Array;
	data: Uint8Array;
	method?: 0 | 8;
	flags?: number;
	/** Write sizes and CRC after the data, as streaming writers do. */
	isDescriptor?: boolean;
	/** Override what the central directory claims. */
	crc?: number;
	compressedSize?: number;
	uncompressedSize?: number;
	/** Pad the local extra field, so its length differs from the central directory's. */
	localExtra?: number;
}

interface BuildOptions {
	isZip64?: boolean;
	comment?: string;
}

/**
 * A hand-built zip, so a test can lie in any single field. fflate writes only honest archives.
 */
function buildZip(entries: TestEntry[], options: BuildOptions = {}): Uint8Array {
	const parts: Uint8Array[] = [];
	const central: Uint8Array[] = [];
	let offset = 0;
	const push = (bytes: Uint8Array) => {
		parts.push(bytes);
		offset += bytes.length;
	};
	for (const entry of entries) {
		const name = typeof entry.name === 'string' ? strToU8(entry.name) : entry.name;
		const method = entry.method ?? 8;
		const stored = method === 8 ? deflateSync(entry.data) : entry.data;
		const crc = entry.crc ?? crc32(entry.data);
		const compressedSize = entry.compressedSize ?? stored.length;
		const uncompressedSize = entry.uncompressedSize ?? entry.data.length;
		const isNonAscii = name.some((byte) => byte > 0x7f);
		const flags = entry.flags ?? (isNonAscii ? 0x800 : 0) | (entry.isDescriptor ? 8 : 0);
		const localExtra = entry.localExtra ?? 0;

		const local = new DataView(new ArrayBuffer(30));
		local.setUint32(0, 0x04034b50, true);
		local.setUint16(4, 20, true);
		local.setUint16(6, flags, true);
		local.setUint16(8, method, true);
		if (!entry.isDescriptor) {
			local.setUint32(14, crc, true);
			local.setUint32(18, compressedSize, true);
			local.setUint32(22, uncompressedSize, true);
		}
		local.setUint16(26, name.length, true);
		local.setUint16(28, localExtra, true);
		const headerOffset = offset;
		push(new Uint8Array(local.buffer));
		push(name);
		push(new Uint8Array(localExtra));
		push(stored);
		if (entry.isDescriptor) {
			const descriptor = new DataView(new ArrayBuffer(16));
			descriptor.setUint32(0, 0x08074b50, true);
			descriptor.setUint32(4, crc, true);
			descriptor.setUint32(8, stored.length, true);
			descriptor.setUint32(12, entry.data.length, true);
			push(new Uint8Array(descriptor.buffer));
		}

		const extra = options.isZip64 ? new Uint8Array(28) : new Uint8Array(0);
		if (options.isZip64) {
			const view = new DataView(extra.buffer);
			view.setUint16(0, 1, true);
			view.setUint16(2, 24, true);
			view.setBigUint64(4, BigInt(uncompressedSize), true);
			view.setBigUint64(12, BigInt(compressedSize), true);
			view.setBigUint64(20, BigInt(headerOffset), true);
		}
		const cd = new DataView(new ArrayBuffer(46));
		cd.setUint32(0, 0x02014b50, true);
		cd.setUint16(4, 20, true);
		cd.setUint16(6, 20, true);
		cd.setUint16(8, flags, true);
		cd.setUint16(10, method, true);
		cd.setUint32(16, crc, true);
		cd.setUint32(20, options.isZip64 ? 0xffffffff : compressedSize, true);
		cd.setUint32(24, options.isZip64 ? 0xffffffff : uncompressedSize, true);
		cd.setUint16(28, name.length, true);
		cd.setUint16(30, extra.length, true);
		cd.setUint32(42, options.isZip64 ? 0xffffffff : headerOffset, true);
		central.push(new Uint8Array(cd.buffer), name, extra);
	}
	const directoryOffset = offset;
	for (const part of central) push(part);
	const directorySize = offset - directoryOffset;

	if (options.isZip64) {
		const record = new DataView(new ArrayBuffer(56));
		record.setUint32(0, 0x06064b50, true);
		record.setBigUint64(4, 44n, true);
		record.setUint16(12, 45, true);
		record.setUint16(14, 45, true);
		record.setBigUint64(24, BigInt(entries.length), true);
		record.setBigUint64(32, BigInt(entries.length), true);
		record.setBigUint64(40, BigInt(directorySize), true);
		record.setBigUint64(48, BigInt(directoryOffset), true);
		const recordOffset = offset;
		push(new Uint8Array(record.buffer));
		const locator = new DataView(new ArrayBuffer(20));
		locator.setUint32(0, 0x07064b50, true);
		locator.setBigUint64(8, BigInt(recordOffset), true);
		locator.setUint32(16, 1, true);
		push(new Uint8Array(locator.buffer));
	}
	const comment = strToU8(options.comment ?? '');
	const eocd = new DataView(new ArrayBuffer(22));
	eocd.setUint32(0, 0x06054b50, true);
	eocd.setUint16(8, options.isZip64 ? 0xffff : entries.length, true);
	eocd.setUint16(10, options.isZip64 ? 0xffff : entries.length, true);
	eocd.setUint32(12, options.isZip64 ? 0xffffffff : directorySize, true);
	eocd.setUint32(16, options.isZip64 ? 0xffffffff : directoryOffset, true);
	eocd.setUint16(20, comment.length, true);
	push(new Uint8Array(eocd.buffer));
	push(comment);

	const out = new Uint8Array(offset);
	let at = 0;
	for (const part of parts) {
		out.set(part, at);
		at += part.length;
	}
	return out;
}

/** The offset of every occurrence of a 4-byte little-endian signature. */
function findAll(bytes: Uint8Array, signature: number): number[] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const found: number[] = [];
	for (let at = 0; at + 4 <= bytes.length; at++) {
		if (view.getUint32(at, true) === signature) found.push(at);
	}
	return found;
}

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const text = (data: Uint8Array) => new TextDecoder().decode(data);
const CENTRAL = 0x02014b50;
const EOCD = 0x06054b50;

async function readAll(bytes: Uint8Array, limits: Partial<ZipLimits> = {}) {
	const source = memorySource(bytes);
	const directory = await readCentralDirectory(source, limits);
	const files = new Map<string, Uint8Array>();
	for (const entry of directory.entries) {
		if (!entry.isDirectory)
			files.set(entry.name, await drain(await openEntry(source, entry, limits)));
	}
	return { directory, files };
}

async function expectRejected(promise: Promise<unknown>, kind = ValidationError, message?: RegExp) {
	const error = await promise.then(
		() => null,
		(caught: unknown) => caught
	);
	expect(error).toBeInstanceOf(kind);
	if (message) expect((error as Error).message).toMatch(message);
}

const BODY = strToU8('0 HEAD\n1 GEDC\n2 VERS 7.0\n0 TRLR\n'.repeat(40));

// Which inflater the suite exercises. Node 24 has DecompressionStream('deflate-raw'), so the
// default path is the native one; the fflate path is forced to keep the fallback honest.
describe.each([
	['native DecompressionStream', false],
	['fflate fallback', true]
])('reading with %s', (_label, isNativeInflateDisabled) => {
	const limits = { isNativeInflateDisabled };

	it('has the native inflater here', () => {
		expect(typeof DecompressionStream).toBe('function');
	});

	it('lists and streams stored and deflated entries from fflate', async () => {
		const bytes = zipSync({
			'gedcom.ged': [BODY, { level: 6 }],
			'media/a.jpg': [strToU8('JPEG-ish'), { level: 0 }],
			'empty.txt': [new Uint8Array(0), { level: 0 }]
		});
		const { directory, files } = await readAll(bytes, limits);
		expect(directory.entries.map((entry) => [entry.name, entry.method])).toEqual([
			['gedcom.ged', 8],
			['media/a.jpg', 0],
			['empty.txt', 0]
		]);
		expect(files.get('gedcom.ged')).toEqual(BODY);
		expect(text(files.get('media/a.jpg')!)).toBe('JPEG-ish');
		expect(files.get('empty.txt')).toEqual(new Uint8Array(0));
	});

	it('reads entries written with data descriptors', async () => {
		const chunks: Uint8Array[] = [];
		const zip = new Zip((error, chunk) => {
			if (error) throw error;
			chunks.push(chunk);
		});
		const deflated = new ZipDeflate('gedcom.ged');
		zip.add(deflated);
		deflated.push(BODY, true);
		const stored = new ZipPassThrough('media/b.bin');
		zip.add(stored);
		stored.push(strToU8('stored bytes'), true);
		zip.end();
		const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
		let at = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, at);
			at += chunk.length;
		}
		const { files } = await readAll(bytes, limits);
		expect(files.get('gedcom.ged')).toEqual(BODY);
		expect(text(files.get('media/b.bin')!)).toBe('stored bytes');
	});

	it('reads a hand-built data descriptor and a padded local extra field', async () => {
		const bytes = buildZip([
			{ name: 'a.txt', data: BODY, isDescriptor: true, localExtra: 11 },
			{ name: 'b.txt', data: strToU8('plain'), method: 0, localExtra: 3 }
		]);
		const { files } = await readAll(bytes, limits);
		expect(files.get('a.txt')).toEqual(BODY);
		expect(text(files.get('b.txt')!)).toBe('plain');
	});

	it('reads a UTF-8 name', async () => {
		const bytes = zipSync({ 'media/Brontë 日本.jpg': [strToU8('x'), { level: 0 }] });
		const { directory } = await readAll(bytes, limits);
		expect(directory.entries[0].name).toBe('media/Brontë 日本.jpg');
	});

	it('decodes a name without the UTF-8 flag as CP437', async () => {
		// 0x82 is é, 0x81 ü and 0xE1 ß in CP437; they are bytes that are invalid or different as UTF-8.
		const bytes = buildZip([
			{
				name: Uint8Array.of(0x63, 0x61, 0x66, 0x82, 0x81, 0xe1, 0x2e, 0x74),
				data: strToU8('x'),
				flags: 0
			}
		]);
		const { directory } = await readAll(bytes, limits);
		expect(directory.entries[0].name).toBe('caféüß.t');
	});

	it('reads a Zip64 directory', async () => {
		const bytes = buildZip(
			[
				{ name: 'gedcom.ged', data: BODY },
				{ name: 'm.bin', data: strToU8('abc'), method: 0 }
			],
			{ isZip64: true }
		);
		const { directory, files } = await readAll(bytes, limits);
		expect(directory.entries).toHaveLength(2);
		expect(files.get('gedcom.ged')).toEqual(BODY);
		expect(text(files.get('m.bin')!)).toBe('abc');
	});

	it('finds the directory past an archive comment holding a fake end record', async () => {
		const bytes = buildZip([{ name: 'a.txt', data: BODY }], { comment: 'PK\x05\x06 not me' });
		const { files } = await readAll(bytes, limits);
		expect(files.get('a.txt')).toEqual(BODY);
	});

	describe('refusals', () => {
		const one = () => buildZip([{ name: 'a.txt', data: BODY }]);
		const patchCentral = (bytes: Uint8Array, patch: (cd: DataView) => void) => {
			patch(view(bytes.subarray(findAll(bytes, CENTRAL)[0])));
			return bytes;
		};

		it('an encrypted entry', async () => {
			const bytes = patchCentral(one(), (cd) => cd.setUint16(8, cd.getUint16(8, true) | 1, true));
			await expectRejected(readAll(bytes, limits), ValidationError, /encrypted/);
		});

		it('an unknown compression method', async () => {
			const bytes = patchCentral(one(), (cd) => cd.setUint16(10, 12, true));
			await expectRejected(readAll(bytes, limits), ValidationError, /method 12/);
		});

		it('a wrong CRC', async () => {
			const bytes = patchCentral(one(), (cd) => cd.setUint32(16, cd.getUint32(16, true) ^ 1, true));
			await expectRejected(readAll(bytes, limits), ValidationError, /checksum/);
		});

		it('data cut short (deflate stream ends early)', async () => {
			const bytes = buildZip([{ name: 'a.txt', data: BODY, compressedSize: 10 }]);
			await expectRejected(readAll(bytes, limits), ValidationError);
		});

		it('stored data shorter than the directory says', async () => {
			// The directory claims 100 bytes but the entry holds 5, so the next header is read as data.
			const bytes = buildZip([
				{
					name: 'a.txt',
					data: strToU8('short'),
					method: 0,
					uncompressedSize: 100,
					compressedSize: 100
				},
				{ name: 'b.txt', data: strToU8('next'), method: 0 }
			]);
			await expectRejected(readAll(bytes, limits), ValidationError);
		});

		it('an archive cut off before its directory', async () => {
			const bytes = one();
			await expectRejected(readAll(bytes.slice(0, bytes.length - 40), limits), ValidationError);
		});

		it('an uncompressed size smaller than the data', async () => {
			const bytes = buildZip([{ name: 'a.txt', data: BODY, uncompressedSize: 10 }]);
			await expectRejected(readAll(bytes, limits), ValidationError, /longer than it declares/);
		});

		it('an uncompressed size larger than the data', async () => {
			const bytes = buildZip([{ name: 'a.txt', data: BODY, uncompressedSize: BODY.length + 5 }]);
			await expectRejected(readAll(bytes, limits), ValidationError, /shorter than it declares/);
		});

		it('a stored entry whose two sizes differ', async () => {
			const bytes = buildZip([
				{ name: 'a.txt', data: strToU8('abc'), method: 0, uncompressedSize: 2 }
			]);
			await expectRejected(readAll(bytes, limits), ValidationError);
		});

		it('overlapping entries', async () => {
			const bytes = buildZip([
				{ name: 'a.txt', data: BODY, method: 0 },
				{ name: 'b.txt', data: BODY, method: 0 }
			]);
			const [, second] = findAll(bytes, CENTRAL);
			view(bytes.subarray(second)).setUint32(42, 0, true);
			await expectRejected(readAll(bytes, limits), ValidationError, /overlaps/);
		});

		it('an entry whose size runs into the next entry', async () => {
			const bytes = buildZip([
				{
					name: 'a.txt',
					data: BODY,
					method: 0,
					compressedSize: BODY.length + 50,
					uncompressedSize: BODY.length + 50
				},
				{ name: 'b.txt', data: BODY, method: 0 }
			]);
			await expectRejected(readAll(bytes, limits), ValidationError, /overlaps/);
		});

		it('a directory that points outside the file', async () => {
			const bytes = one();
			const eocd = findAll(bytes, EOCD).at(-1)!;
			view(bytes.subarray(eocd)).setUint32(16, bytes.length + 1000, true);
			await expectRejected(readAll(bytes, limits), ValidationError, /outside the file/);
		});

		it('a directory size that runs past the end record', async () => {
			const bytes = one();
			const eocd = findAll(bytes, EOCD).at(-1)!;
			view(bytes.subarray(eocd)).setUint32(12, 100_000, true);
			await expectRejected(readAll(bytes, limits), ValidationError);
		});

		it('an entry count that does not match the directory', async () => {
			const bytes = one();
			const eocd = findAll(bytes, EOCD).at(-1)!;
			view(bytes.subarray(eocd)).setUint16(10, 3, true);
			view(bytes.subarray(eocd)).setUint16(8, 3, true);
			await expectRejected(readAll(bytes, limits), ValidationError);
		});

		it('a Zip64 marker with no locator', async () => {
			const bytes = one();
			const eocd = findAll(bytes, EOCD).at(-1)!;
			view(bytes.subarray(eocd)).setUint16(10, 0xffff, true);
			await expectRejected(readAll(bytes, limits), ValidationError, /Zip64/);
		});

		it('more entries than the limit', async () => {
			const bytes = buildZip([
				{ name: 'a', data: strToU8('1') },
				{ name: 'b', data: strToU8('2') }
			]);
			await expectRejected(
				readAll(bytes, { ...limits, maxEntries: 1 }),
				PayloadTooLargeError,
				/too many entries/
			);
		});

		it('a declared total over the limit', async () => {
			await expectRejected(
				readAll(one(), { ...limits, maxUncompressedBytes: 100 }),
				PayloadTooLargeError
			);
		});

		it('an oversized directory', async () => {
			await expectRejected(
				readAll(one(), { ...limits, maxDirectoryBytes: 10 }),
				PayloadTooLargeError
			);
		});

		it('a local header that names another entry', async () => {
			const bytes = buildZip([{ name: 'a.txt', data: BODY }]);
			bytes[30] = 'z'.charCodeAt(0);
			await expectRejected(readAll(bytes, limits), ValidationError, /local header/);
		});

		it('a local header that is not there', async () => {
			const bytes = buildZip([{ name: 'a.txt', data: BODY }]);
			bytes[0] = 0;
			await expectRejected(readAll(bytes, limits), ValidationError, /local header/);
		});

		it('a file that is not a zip', async () => {
			await expectRejected(readAll(strToU8('just some text, nowhere near a zip file'), limits));
			await expectRejected(readAll(new Uint8Array(3), limits));
		});

		it('a bomb by declared ratio, before any inflating', async () => {
			// 20 MiB of zeros deflates to roughly 1032:1, past the 1000:1 default.
			const bytes = buildZip([{ name: 'zeros', data: new Uint8Array(20 * 1024 * 1024) }]);
			await expectRejected(readAll(bytes, limits), ValidationError, /expands too much/);
		});

		it('a bomb that hides its size, caught while streaming', async () => {
			const bytes = buildZip([{ name: 'zeros', data: new Uint8Array(200_000) }]);
			const source = memorySource(bytes);
			const loose = { ...limits, ratioFloorBytes: 1_000_000 };
			const directory = await readCentralDirectory(source, loose);
			const strict = { ...limits, maxExpansionRatio: 5, ratioFloorBytes: 1000 };
			await expectRejected(
				drain(await openEntry(source, directory.entries[0], strict)),
				ValidationError,
				/expands too much/
			);
		});

		it('a folder opened as a file', async () => {
			const bytes = buildZip([{ name: 'media/', data: new Uint8Array(0), method: 0 }]);
			const source = memorySource(bytes);
			const directory = await readCentralDirectory(source, limits);
			expect(directory.entries[0].isDirectory).toBe(true);
			await expectRejected(openEntry(source, directory.entries[0], limits));
		});
	});
});

describe('the official GEDCOM 7.0 archives', () => {
	const folder = new URL('./fixtures/conformance/files/', import.meta.url);
	const load = (name: string) => {
		const url = new URL(name, folder);
		return existsSync(url) ? new Uint8Array(readFileSync(url)) : null;
	};
	const minimal = load('minimal70.gdz');
	const maximal = load('maximal70.gdz');

	// The files are fetched by `npm run gedcom:conformance` and gitignored, so a fresh clone skips.
	describe.skipIf(!minimal || !maximal)('when fetched', () => {
		it('reads minimal70.gdz', async () => {
			const { directory, files } = await readAll(minimal!);
			expect(directory.entries.map((entry) => entry.name)).toEqual(['gedcom.ged']);
			expect(text(files.get('gedcom.ged')!)).toMatch(/^0 HEAD/);
		});

		it.each([false, true])(
			'streams every entry of maximal70.gdz (fflate: %s)',
			async (isFallback) => {
				const { directory, files } = await readAll(maximal!, {
					isNativeInflateDisabled: isFallback
				});
				const names = directory.entries.map((entry) => entry.name);
				expect(names).toEqual([
					'gedcom.ged',
					'media/',
					'media/CharlotteBrontë.jpg',
					'media/derived.oga',
					'media/original.mp3',
					'media/transcript.vtt',
					'path/',
					'path/to/',
					'path/to/file1'
				]);
				expect(files.get('media/CharlotteBrontë.jpg')).toHaveLength(79000);
				expect(files.get('gedcom.ged')).toHaveLength(15112);
				expect(files.get('media/transcript.vtt')).toHaveLength(35);
				expect(directory.entries.filter((entry) => entry.isDirectory)).toHaveLength(3);
				// The data descriptor entries carry no sizes in the local header, so the directory's are used.
				expect(directory.totalUncompressedBytes).toBe(15112 + 79000 + 210 + 625 + 35 + 28);
			}
		);
	});
});

describe('the archive limits', () => {
	it('allow a full tree of media plus its dataset', () => {
		expect(MAX_GEDZIP_UPLOAD_BYTES).toBe(MAX_TREE_MEDIA_BYTES + MAX_DATASET_BYTES);
		expect(MAX_GEDZIP_UNCOMPRESSED_BYTES).toBeGreaterThanOrEqual(MAX_GEDZIP_UPLOAD_BYTES);
	});
});

describe('r2ZipSource', () => {
	it('reads by range and never fetches the whole object', async () => {
		const filler = new Uint8Array(300_000).map((_, index) => (index * 2654435761) >>> 24);
		const bytes = zipSync({
			'gedcom.ged': [BODY, { level: 6 }],
			'media/big.bin': [filler, { level: 0 }]
		});
		const ranges: Array<{ offset: number; length: number }> = [];
		const bucket = {
			async head() {
				return { size: bytes.length };
			},
			async get(_key: string, options: { range: { offset: number; length: number } }) {
				ranges.push(options.range);
				const slice = bytes.slice(
					options.range.offset,
					options.range.offset + options.range.length
				);
				return {
					arrayBuffer: async () => slice.buffer,
					body: new Blob([slice]).stream()
				};
			}
		};
		const source = await r2ZipSource(bucket as never, 'staging/x.gdz');
		const directory = await readCentralDirectory(source);
		const entry: ZipEntry = directory.entries[0];
		expect(text(await drain(await openEntry(source, entry)))).toBe(text(BODY));
		expect(ranges.length).toBeGreaterThan(0);
		expect(ranges.every((range) => range.length < bytes.length)).toBe(true);
	});

	it('refuses a missing object', async () => {
		const bucket = { head: async () => null };
		await expectRejected(r2ZipSource(bucket as never, 'gone'));
	});
});
