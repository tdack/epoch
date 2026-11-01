import { strToU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../domain/errors';
import {
	deflateEntry,
	MAX_ZIP_ENTRIES,
	segmentLength,
	writeCentralDirectory,
	writeSegment,
	ZIP_METHOD,
	type ZipEntry,
	type ZipEntryRecord
} from './zip-writer';
import { crc32 } from './crc32';

async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
	const parts: Uint8Array[] = [];
	const reader = stream.getReader();
	for (;;) {
		const { done: isDone, value } = await reader.read();
		if (isDone) break;
		parts.push(value);
	}
	return concat(parts);
}

function concat(parts: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.byteLength;
	}
	return out;
}

function chunked(bytes: Uint8Array, size: number): ReadableStream<Uint8Array> {
	let at = 0;
	return new ReadableStream({
		pull(controller) {
			if (at >= bytes.byteLength) return controller.close();
			controller.enqueue(bytes.subarray(at, at + size));
			at += size;
		}
	});
}

/** Writes each batch as a segment at the running offset and returns the joined archive. */
async function writeArchive(batches: ZipEntry[][]) {
	const parts: Uint8Array[] = [];
	const records: ZipEntryRecord[] = [];
	let offset = 0;
	const lengths: Array<{ declared: number | undefined; actual: number }> = [];
	for (const batch of batches) {
		const segment = writeSegment(batch, offset);
		const bytes = await drain(segment.stream);
		lengths.push({ declared: segment.length, actual: bytes.byteLength });
		records.push(...(await segment.records));
		parts.push(bytes);
		offset += bytes.byteLength;
	}
	parts.push(writeCentralDirectory(records, offset));
	return { archive: concat(parts), records, lengths };
}

const png = Uint8Array.from({ length: 1000 }, (_, i) => (i * 7) & 0xff);
const jpg = Uint8Array.from({ length: 300 }, (_, i) => 255 - (i & 0xff));
const ged = strToU8('0 HEAD\n1 GEDC\n2 VERS 7.0\n0 TRLR\n'.repeat(50));

describe('zip writer', () => {
	it('writes segments with known and unknown CRCs, both methods, UTF-8 names and empty files', async () => {
		const { archive, records, lengths } = await writeArchive([
			[
				deflateEntry('gedcom.ged', ged),
				{ name: 'media/a-1.png', data: png, crc32: crc32(png) },
				{ name: 'media/empty.txt', data: new Uint8Array(0), crc32: 0 }
			],
			[
				{ name: 'media/ünï-cödé-日本.jpg', data: jpg },
				{ name: 'media/streamed.bin', data: chunked(png, 64), compressedSize: png.byteLength },
				{ name: 'media/empty-unknown.txt', data: new Uint8Array(0) }
			],
			[
				{
					name: 'media/known-stream.bin',
					data: chunked(jpg, 33),
					compressedSize: jpg.byteLength,
					crc32: crc32(jpg)
				}
			]
		]);

		for (const l of lengths) expect(l.declared).toBe(l.actual);

		const files = unzipSync(archive);
		expect(Object.keys(files)).toEqual(
			expect.arrayContaining([
				'gedcom.ged',
				'media/a-1.png',
				'media/empty.txt',
				'media/ünï-cödé-日本.jpg',
				'media/streamed.bin',
				'media/empty-unknown.txt',
				'media/known-stream.bin'
			])
		);
		expect(files['gedcom.ged']).toEqual(ged);
		expect(files['media/a-1.png']).toEqual(png);
		expect(files['media/empty.txt'].byteLength).toBe(0);
		expect(files['media/ünï-cödé-日本.jpg']).toEqual(jpg);
		expect(files['media/streamed.bin']).toEqual(png);
		expect(files['media/known-stream.bin']).toEqual(jpg);

		const byName = new Map(records.map((r) => [r.name, r]));
		expect(byName.get('gedcom.ged')?.method).toBe(ZIP_METHOD.deflate);
		expect(byName.get('gedcom.ged')!.compressedSize).toBeLessThan(ged.byteLength);
		expect(byName.get('media/streamed.bin')!.crc32).toBe(crc32(png));
		expect(byName.get('media/ünï-cödé-日本.jpg')!.crc32).toBe(crc32(jpg));
		// bit 3 only where the CRC was computed on the fly, bit 11 everywhere.
		expect(byName.get('media/a-1.png')!.flags).toBe(0x0800);
		expect(byName.get('media/streamed.bin')!.flags).toBe(0x0808);
	});

	it('records each entry at its absolute offset across segments', async () => {
		const { archive, records, lengths } = await writeArchive([
			[{ name: 'one', data: png }],
			[{ name: 'two', data: jpg, crc32: crc32(jpg) }]
		]);
		expect(records[0].localHeaderOffset).toBe(0);
		expect(records[1].localHeaderOffset).toBe(lengths[0].actual);
		const view = new DataView(archive.buffer, archive.byteOffset);
		expect(view.getUint32(records[1].localHeaderOffset, true)).toBe(0x04034b50);
		// the EOCD points at the central directory, which starts after both segments
		const eocd = archive.byteLength - 22;
		expect(view.getUint32(eocd + 16, true)).toBe(lengths[0].actual + lengths[1].actual);
	});

	it('reports segmentLength exactly, and refuses when a size is unknown', () => {
		const entries: ZipEntry[] = [
			{ name: 'a', data: png },
			{ name: 'b', data: jpg, crc32: 1 }
		];
		// 30 + 1 + 1000 + 16 (descriptor) and 30 + 1 + 300
		expect(segmentLength(entries)).toBe(1047 + 331);
		expect(() => segmentLength([{ name: 'x', data: chunked(png, 10) }])).toThrow(ValidationError);
		expect(writeSegment([{ name: 'x', data: chunked(png, 10) }], 0).length).toBeUndefined();
	});

	it('fails the stream when a declared size is wrong', async () => {
		const segment = writeSegment(
			[{ name: 'lie', data: chunked(png, 100), compressedSize: png.byteLength - 1 }],
			0
		);
		await expect(drain(segment.stream)).rejects.toThrow(/declared/);
		await expect(segment.records).rejects.toThrow(/declared/);
	});

	it('refuses more than 65,535 entries and offsets or sizes of 4 GiB', () => {
		const tiny = (n: number): ZipEntry[] =>
			Array.from({ length: n }, (_, i) => ({ name: `f${i}`, data: new Uint8Array(0), crc32: 0 }));
		expect(() => writeSegment(tiny(MAX_ZIP_ENTRIES + 1), 0)).toThrow(/65535/);
		expect(() => writeSegment(tiny(MAX_ZIP_ENTRIES), 0)).not.toThrow();
		const record = (over: Partial<ZipEntryRecord>): ZipEntryRecord => ({
			name: 'r',
			crc32: 0,
			compressedSize: 0,
			uncompressedSize: 0,
			localHeaderOffset: 0,
			method: ZIP_METHOD.stored,
			flags: 0x800,
			...over
		});
		expect(() => writeCentralDirectory(Array(MAX_ZIP_ENTRIES + 1).fill(record({})), 0)).toThrow(
			/65535/
		);
		const big = 2 ** 32;
		expect(() => writeCentralDirectory([record({})], big)).toThrow(/4 GiB/);
		expect(() => writeCentralDirectory([record({ localHeaderOffset: big })], 0)).toThrow(/4 GiB/);
		expect(() => writeSegment([], big)).toThrow(/4 GiB/);
		const huge = { name: 'huge', data: chunked(png, 10), compressedSize: big };
		expect(() => segmentLength([huge])).toThrow(/4 GiB/);
		expect(() => writeSegment([huge], 0)).toThrow(/4 GiB/);
	});
});

// The project has no Node typings, so the fixture is read through untyped dynamic imports; it is
// fetched by `npm run gedcom:conformance` and absent on a fresh clone.
const fsModule = 'node:fs';
const urlModule = 'node:url';
const fs = (await import(/* @vite-ignore */ fsModule)) as {
	existsSync(path: string): boolean;
	readFileSync(path: string): Uint8Array;
};
const url = (await import(/* @vite-ignore */ urlModule)) as { fileURLToPath(url: URL): string };
const maximal = url.fileURLToPath(
	new URL('../../../../test/gedcom/conformance/files/maximal70.gdz', import.meta.url)
);

describe.skipIf(!fs.existsSync(maximal))('the official maximal70.gdz', () => {
	it('is rewritten as two segments with every entry intact', async () => {
		const source = unzipSync(new Uint8Array(fs.readFileSync(maximal)));
		const names = Object.keys(source).filter((n) => !n.endsWith('/'));
		const entryFor = (name: string, index: number): ZipEntry =>
			name === 'gedcom.ged'
				? deflateEntry(name, source[name])
				: // alternate known and unknown CRCs so both paths run over real files
					index % 2
					? { name, data: source[name], crc32: crc32(source[name]) }
					: { name, data: source[name] };
		const entries = names.map(entryFor);
		const half = Math.ceil(entries.length / 2);
		const { archive } = await writeArchive([entries.slice(0, half), entries.slice(half)]);
		const back = unzipSync(archive);
		expect(Object.keys(back).sort()).toEqual(names.sort());
		for (const name of names) expect(back[name]).toEqual(source[name]);
	});
});
