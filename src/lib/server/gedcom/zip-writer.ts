/**
 * A streaming zip writer for segmented GEDZIP exports (ADR-074, "Export with segments").
 *
 * An archive is built in pieces: each segment is a run of local headers and data written to its own
 * R2 object by a separate Workflow step, and a tail (central directory + end record) is written
 * last. Joining the pieces in order gives one valid zip, because every offset in the central
 * directory is absolute and each segment is told where it starts. The central directory is the
 * authority for readers, so nothing needs to be rewritten after the fact.
 *
 * No Zip64: the caps below (`MAX_ZIP_ENTRIES`, `MAX_ZIP_FIELD_BYTES`) are far above what the export
 * caps allow, and refusing is cheaper than writing a second format nobody exercises.
 *
 * Deflate: entries are compressed by the caller with `deflateEntry`, which uses fflate's
 * `deflateSync` (not `CompressionStream('deflate-raw')`, whose Workers support is undocumented).
 * It is only meant for the dataset, which is held in memory anyway; media is stored.
 */

import { deflateSync } from 'fflate';
import { ValidationError } from '../domain/errors';
import { crc32, crc32Update } from './crc32';

/** A zip's entry count is a 16-bit field; 0xFFFF is its Zip64 marker, so it is the last usable value. */
export const MAX_ZIP_ENTRIES = 65_535;

/** Offsets and sizes are 32-bit fields; 0xFFFFFFFF is the Zip64 marker, so 4 GiB - 1 is refused too. */
const MAX_ZIP_FIELD_BYTES = 0xffff_ffff;

export const ZIP_METHOD = { stored: 0, deflate: 8 } as const;
type ZipMethod = (typeof ZIP_METHOD)[keyof typeof ZIP_METHOD];

/** Bit 3: sizes and CRC follow the data. Bit 11: the name is UTF-8. */
const FLAG_DATA_DESCRIPTOR = 0x0008;
const FLAG_UTF8_NAME = 0x0800;

const LOCAL_HEADER_BYTES = 30;
const DATA_DESCRIPTOR_BYTES = 16;
const CENTRAL_HEADER_BYTES = 46;
const EOCD_BYTES = 22;

/** 1980-01-01 00:00. A fixed stamp keeps the output reproducible; nothing reads these times. */
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

/** Version 2.0 covers both methods and UTF-8 names. */
const ZIP_VERSION = 20;

const encoder = new TextEncoder();

export interface ZipEntry {
	/** Path inside the archive, UTF-8, forward slashes. */
	name: string;
	/** The bytes to write: stored as given, or already deflated when `method` is deflate. */
	data: Uint8Array | ReadableStream<Uint8Array>;
	method?: ZipMethod;
	/** Bytes of `data` as written. Optional for a `Uint8Array`; required for a stream. */
	compressedSize?: number;
	/** Bytes once inflated. Defaults to `compressedSize` when stored. Required for deflate. */
	uncompressedSize?: number;
	/**
	 * CRC-32 of the inflated bytes, when known (the `crc32` column). Present: a complete local
	 * header and no data descriptor. Absent: computed while streaming, written in a descriptor.
	 * Required for deflate.
	 */
	crc32?: number;
}

/** What the central directory needs about a written entry. */
export interface ZipEntryRecord {
	name: string;
	crc32: number;
	compressedSize: number;
	uncompressedSize: number;
	localHeaderOffset: number;
	method: ZipMethod;
	flags: number;
}

export interface ZipSegment {
	stream: ReadableStream<Uint8Array>;
	/** Exact byte length of `stream`, or undefined when an entry's size is not known in advance. */
	length: number | undefined;
	/** Settles once `stream` is fully consumed; rejects if it errors. */
	records: Promise<ZipEntryRecord[]>;
}

/** Deflate `bytes` into an entry; the CRC and both sizes are known, so no descriptor is needed. */
export function deflateEntry(name: string, bytes: Uint8Array): ZipEntry {
	const data = deflateSync(bytes);
	return {
		name,
		data,
		method: ZIP_METHOD.deflate,
		compressedSize: data.byteLength,
		uncompressedSize: bytes.byteLength,
		crc32: crc32(bytes)
	};
}

interface Planned {
	nameBytes: Uint8Array;
	method: ZipMethod;
	compressedSize: number | undefined;
	uncompressedSize: number | undefined;
	crc32: number | undefined;
	isDescriptor: boolean;
}

function checkField(what: string, value: number): void {
	if (value >= MAX_ZIP_FIELD_BYTES) {
		throw new ValidationError(
			`${what} ${value} reaches the ${MAX_ZIP_FIELD_BYTES} byte (4 GiB) limit of a zip without Zip64`
		);
	}
}

function plan(entry: ZipEntry): Planned {
	const method = entry.method ?? ZIP_METHOD.stored;
	const nameBytes = encoder.encode(entry.name);
	if (nameBytes.byteLength === 0 || nameBytes.byteLength > 0xffff) {
		throw new ValidationError(`Zip entry name "${entry.name}" must be 1 to 65535 bytes`);
	}
	const bufferBytes = entry.data instanceof Uint8Array ? entry.data.byteLength : undefined;
	let compressedSize = entry.compressedSize ?? bufferBytes;
	if (bufferBytes !== undefined && compressedSize !== bufferBytes) {
		throw new ValidationError(`Zip entry ${entry.name}: compressedSize disagrees with its data`);
	}
	let uncompressedSize = entry.uncompressedSize;
	if (method === ZIP_METHOD.stored) {
		uncompressedSize ??= compressedSize;
		compressedSize ??= uncompressedSize;
		if (compressedSize !== uncompressedSize) {
			throw new ValidationError(`Zip entry ${entry.name}: a stored entry's sizes must match`);
		}
	} else if (
		compressedSize === undefined ||
		uncompressedSize === undefined ||
		entry.crc32 === undefined
	) {
		throw new ValidationError(`Zip entry ${entry.name}: deflate needs both sizes and the CRC-32`);
	}
	if (compressedSize !== undefined) checkField(`Zip entry ${entry.name} size`, compressedSize);
	if (uncompressedSize !== undefined) checkField(`Zip entry ${entry.name} size`, uncompressedSize);
	const isDescriptor = entry.crc32 === undefined;
	return { nameBytes, method, compressedSize, uncompressedSize, crc32: entry.crc32, isDescriptor };
}

function localHeader(p: Planned): Uint8Array {
	const header = new Uint8Array(LOCAL_HEADER_BYTES + p.nameBytes.byteLength);
	const view = new DataView(header.buffer);
	view.setUint32(0, 0x04034b50, true);
	view.setUint16(4, ZIP_VERSION, true);
	view.setUint16(6, FLAG_UTF8_NAME | (p.isDescriptor ? FLAG_DATA_DESCRIPTOR : 0), true);
	view.setUint16(8, p.method, true);
	view.setUint16(10, DOS_TIME, true);
	view.setUint16(12, DOS_DATE, true);
	// With a descriptor the three fields are zero by spec; the real values come after the data.
	view.setUint32(14, p.isDescriptor ? 0 : p.crc32!, true);
	view.setUint32(18, p.isDescriptor ? 0 : p.compressedSize!, true);
	view.setUint32(22, p.isDescriptor ? 0 : p.uncompressedSize!, true);
	view.setUint16(26, p.nameBytes.byteLength, true);
	view.setUint16(28, 0, true);
	header.set(p.nameBytes, LOCAL_HEADER_BYTES);
	return header;
}

function dataDescriptor(crc: number, size: number): Uint8Array {
	const bytes = new Uint8Array(DATA_DESCRIPTOR_BYTES);
	const view = new DataView(bytes.buffer);
	view.setUint32(0, 0x08074b50, true);
	view.setUint32(4, crc, true);
	view.setUint32(8, size, true);
	view.setUint32(12, size, true);
	return bytes;
}

function plannedLength(plans: readonly Planned[], names: readonly string[]): number {
	let total = 0;
	plans.forEach((p, i) => {
		if (p.compressedSize === undefined) {
			throw new ValidationError(`Zip entry ${names[i]} has no known size`);
		}
		total +=
			LOCAL_HEADER_BYTES +
			p.nameBytes.byteLength +
			p.compressedSize +
			(p.isDescriptor ? DATA_DESCRIPTOR_BYTES : 0);
	});
	checkField('Zip segment length', total);
	return total;
}

/**
 * The exact byte length of a segment. Throws when an entry's size is not known in advance, since
 * then there is no exact length to give a `FixedLengthStream`.
 */
export function segmentLength(entries: readonly ZipEntry[]): number {
	return plannedLength(
		entries.map(plan),
		entries.map((e) => e.name)
	);
}

async function* segmentChunks(
	entries: readonly ZipEntry[],
	plans: readonly Planned[],
	startOffset: number,
	records: ZipEntryRecord[]
): AsyncGenerator<Uint8Array> {
	let offset = startOffset;
	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		const p = plans[i];
		const header = localHeader(p);
		checkField(`Zip entry ${entry.name} offset`, offset);
		const localHeaderOffset = offset;
		yield header;
		offset += header.byteLength;

		let written = 0;
		let crc = 0;
		const chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array> =
			entry.data instanceof Uint8Array ? [entry.data] : streamChunks(entry.data);
		for await (const chunk of chunks) {
			written += chunk.byteLength;
			if (p.isDescriptor) crc = crc32Update(crc, chunk);
			yield chunk;
		}
		// A FixedLengthStream downstream would fail obscurely on a short or long entry; say which.
		if (p.compressedSize !== undefined && written !== p.compressedSize) {
			throw new ValidationError(
				`Zip entry ${entry.name} was ${written} bytes, not the ${p.compressedSize} declared`
			);
		}
		checkField(`Zip entry ${entry.name} size`, written);
		offset += written;

		if (p.isDescriptor) {
			yield dataDescriptor(crc, written);
			offset += DATA_DESCRIPTOR_BYTES;
		}
		records.push({
			name: entry.name,
			crc32: p.isDescriptor ? crc : p.crc32!,
			compressedSize: written,
			uncompressedSize: p.isDescriptor ? written : p.uncompressedSize!,
			localHeaderOffset,
			method: p.method,
			flags: FLAG_UTF8_NAME | (p.isDescriptor ? FLAG_DATA_DESCRIPTOR : 0)
		});
	}
	checkField('Zip segment end offset', offset);
}

// Not `for await` over the stream itself: async iteration of ReadableStream is not in every runtime.
async function* streamChunks(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
	const reader = stream.getReader();
	try {
		for (;;) {
			const { done: isDone, value } = await reader.read();
			if (isDone) return;
			yield value;
		}
	} finally {
		await reader.cancel().catch(() => undefined);
		reader.releaseLock();
	}
}

/**
 * The local headers and data for one batch of entries, as they will sit at `startOffset` (the sum
 * of the lengths of every segment before it) in the finished archive.
 */
export function writeSegment(entries: readonly ZipEntry[], startOffset: number): ZipSegment {
	if (entries.length > MAX_ZIP_ENTRIES) {
		throw new ValidationError(
			`A zip holds at most ${MAX_ZIP_ENTRIES} entries without Zip64; this segment has ${entries.length}`
		);
	}
	checkField('Zip segment start offset', startOffset);
	const plans = entries.map(plan);
	const length = plans.every((p) => p.compressedSize !== undefined)
		? plannedLength(
				plans,
				entries.map((e) => e.name)
			)
		: undefined;

	const recordList: ZipEntryRecord[] = [];
	const generator = segmentChunks(entries, plans, startOffset, recordList);
	let settle!: { resolve: (r: ZipEntryRecord[]) => void; reject: (e: unknown) => void };
	const records = new Promise<ZipEntryRecord[]>((resolve, reject) => {
		settle = { resolve, reject };
	});
	// A caller that only wants the bytes must not trip an unhandled rejection; the stream errors too.
	records.catch(() => undefined);

	const stream = new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const next = await generator.next();
				if (next.done) {
					controller.close();
					settle.resolve(recordList);
				} else {
					controller.enqueue(next.value);
				}
			} catch (err) {
				settle.reject(err);
				controller.error(err);
			}
		},
		async cancel(reason) {
			settle.reject(reason ?? new Error('Zip segment stream cancelled'));
			await generator.return(undefined);
		}
	});
	return { stream, length, records };
}

/** The central directory and end-of-central-directory record, to follow the last segment. */
export function writeCentralDirectory(
	records: readonly ZipEntryRecord[],
	cdOffset: number
): Uint8Array<ArrayBuffer> {
	if (records.length > MAX_ZIP_ENTRIES) {
		throw new ValidationError(
			`A zip holds at most ${MAX_ZIP_ENTRIES} entries without Zip64; this archive has ${records.length}`
		);
	}
	checkField('Zip central directory offset', cdOffset);
	const names = records.map((r) => encoder.encode(r.name));
	const cdBytes = names.reduce((sum, n) => sum + CENTRAL_HEADER_BYTES + n.byteLength, 0);
	checkField('Zip central directory end', cdOffset + cdBytes);

	const out = new Uint8Array(cdBytes + EOCD_BYTES);
	const view = new DataView(out.buffer);
	let at = 0;
	records.forEach((r, i) => {
		checkField(`Zip entry ${r.name} offset`, r.localHeaderOffset);
		checkField(`Zip entry ${r.name} size`, r.compressedSize);
		checkField(`Zip entry ${r.name} size`, r.uncompressedSize);
		view.setUint32(at, 0x02014b50, true);
		view.setUint16(at + 4, ZIP_VERSION, true);
		view.setUint16(at + 6, ZIP_VERSION, true);
		view.setUint16(at + 8, r.flags, true);
		view.setUint16(at + 10, r.method, true);
		view.setUint16(at + 12, DOS_TIME, true);
		view.setUint16(at + 14, DOS_DATE, true);
		view.setUint32(at + 16, r.crc32, true);
		view.setUint32(at + 20, r.compressedSize, true);
		view.setUint32(at + 24, r.uncompressedSize, true);
		view.setUint16(at + 28, names[i].byteLength, true);
		// extra, comment, disk, internal and external attributes stay zero.
		view.setUint32(at + 42, r.localHeaderOffset, true);
		out.set(names[i], at + CENTRAL_HEADER_BYTES);
		at += CENTRAL_HEADER_BYTES + names[i].byteLength;
	});
	view.setUint32(at, 0x06054b50, true);
	view.setUint16(at + 8, records.length, true);
	view.setUint16(at + 10, records.length, true);
	view.setUint32(at + 12, cdBytes, true);
	view.setUint32(at + 16, cdOffset, true);
	return out;
}
