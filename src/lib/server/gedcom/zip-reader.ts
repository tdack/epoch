/**
 * A zip reader for archives that live in R2: it reads the central directory by range, then streams
 * one entry at a time. It never holds the archive, and never holds more than a chunk of an entry,
 * because a `.gdz` may carry gigabytes of media and the isolate has 128 MB (ADR-074).
 *
 * `unpackGedzip` stays the reader of `gedcom.ged` for an archive that is already in memory; this
 * module is for the media, and for the central directory a preview needs before anything is written.
 *
 * Every number in a zip is the archive's own claim. The reader therefore trusts none of them until
 * it has checked them against the file's size, against each other, and, for an entry's size and CRC,
 * against the bytes that actually come out.
 */

import { Inflate } from 'fflate';
import type { R2Bucket } from '@cloudflare/workers-types';
import { PayloadTooLargeError, ValidationError } from '../domain/errors';
import { crc32Update } from './crc32';
import {
	GEDZIP_RATIO_FLOOR_BYTES,
	MAX_GEDZIP_DIRECTORY_BYTES,
	MAX_GEDZIP_ENTRIES,
	MAX_GEDZIP_EXPANSION_RATIO,
	MAX_GEDZIP_UNCOMPRESSED_BYTES
} from './limits';

/** Where a zip's bytes come from: R2 in production, a buffer in tests. */
export interface ZipSource {
	/** The archive's length in bytes. */
	size: number;
	/** `length` bytes from `offset`, fully buffered. Used only for headers, which are small. */
	readRange(offset: number, length: number): Promise<Uint8Array>;
	/** The same range as a stream, for entry data. */
	readStream(offset: number, length: number): Promise<ReadableStream<Uint8Array>>;
}

/** A source over an R2 object: one `head` for the size, then a ranged `get` per read. */
export async function r2ZipSource(bucket: R2Bucket, key: string): Promise<ZipSource> {
	const head = await bucket.head(key);
	if (!head) throw new ValidationError('The archive is no longer stored');
	const get = async (offset: number, length: number) => {
		if (length === 0) return null;
		const object = await bucket.get(key, { range: { offset, length } });
		if (!object) throw new ValidationError('The archive is no longer stored');
		return object;
	};
	return {
		size: head.size,
		async readRange(offset, length) {
			const object = await get(offset, length);
			return object ? new Uint8Array(await object.arrayBuffer()) : new Uint8Array(0);
		},
		async readStream(offset, length) {
			const object = await get(offset, length);
			// R2's stream type is the workers-types one; it is the same object at run time.
			return (object?.body ?? new Blob([]).stream()) as unknown as ReadableStream<Uint8Array>;
		}
	};
}

/** The compression methods read: stored and deflate. Zip defines others; none is accepted. */
export const ZIP_METHOD = { stored: 0, deflate: 8 } as const;

export interface ZipEntry {
	/** The name decoded per the entry's UTF-8 flag (UTF-8) or, without it, as CP437. */
	name: string;
	/** True for a folder entry (a name ending in `/`). It has no data. */
	isDirectory: boolean;
	method: (typeof ZIP_METHOD)[keyof typeof ZIP_METHOD];
	/** Unsigned CRC-32 of the uncompressed bytes. */
	crc32: number;
	compressedSize: number;
	uncompressedSize: number;
	/** Offset of the local file header. The data follows it at an offset only that header gives. */
	localHeaderOffset: number;
	/** The entry's name bytes as stored, to check the local header names the same entry. */
	rawName: Uint8Array;
	/** Where the next thing in the archive begins: the entry's data must end at or before this. */
	dataLimit: number;
}

export interface ZipDirectory {
	/** In central-directory order. */
	entries: ZipEntry[];
	/** Where the central directory starts; everything before it is entry data. */
	centralDirectoryOffset: number;
	/** The sum of the entries' declared uncompressed sizes. */
	totalUncompressedBytes: number;
}

/** The limits the reader enforces, overridable so tests need not build a 50,000-entry archive. */
export interface ZipLimits {
	maxEntries: number;
	maxUncompressedBytes: number;
	maxDirectoryBytes: number;
	maxExpansionRatio: number;
	ratioFloorBytes: number;
	/** Use fflate instead of the platform's `DecompressionStream`. Tests only. */
	isNativeInflateDisabled: boolean;
}

const DEFAULT_LIMITS: ZipLimits = {
	maxEntries: MAX_GEDZIP_ENTRIES,
	maxUncompressedBytes: MAX_GEDZIP_UNCOMPRESSED_BYTES,
	maxDirectoryBytes: MAX_GEDZIP_DIRECTORY_BYTES,
	maxExpansionRatio: MAX_GEDZIP_EXPANSION_RATIO,
	ratioFloorBytes: GEDZIP_RATIO_FLOOR_BYTES,
	isNativeInflateDisabled: false
};

const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

const EOCD_BYTES = 22;
const ZIP64_LOCATOR_BYTES = 20;
const ZIP64_EOCD_BYTES = 56;
const CENTRAL_HEADER_BYTES = 46;
const LOCAL_HEADER_BYTES = 30;
/** The EOCD is followed by a comment of up to 65,535 bytes, so it is within this of the end. */
const EOCD_SEARCH_BYTES = 65_535 + EOCD_BYTES;
/** The 16-bit entry count's ceiling, and what a Zip64 archive is capped to as well. */
const MAX_ZIP_ENTRIES = 0xffff;

const FLAG_ENCRYPTED = 0x0001;
const FLAG_UTF8_NAME = 0x0800;
/** Strong encryption and the "masked header" scheme: both mean the data is not plain. */
const FLAG_STRONG_ENCRYPTION = 0x0040;
const FLAG_MASKED_HEADERS = 0x2000;

const bad = (message: string) => new ValidationError(`The archive is not a valid zip: ${message}`);

function toSafeNumber(value: bigint, what: string): number {
	if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw bad(`${what} is out of range`);
	return Number(value);
}

/**
 * Reads the archive's directory. Throws `ValidationError` for anything malformed or unsupported
 * and `PayloadTooLargeError` when it declares more than the limits allow.
 */
export async function readCentralDirectory(
	source: ZipSource,
	limits: Partial<ZipLimits> = {}
): Promise<ZipDirectory> {
	const config = { ...DEFAULT_LIMITS, ...limits };
	const { size } = source;
	if (size < EOCD_BYTES) throw bad('it is too small to hold a directory');

	const tailStart = Math.max(0, size - EOCD_SEARCH_BYTES);
	const tail = await source.readRange(tailStart, size - tailStart);
	const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);

	// Scanning backwards and demanding that the comment length reach the end of the file exactly
	// stops a comment that happens to contain "PK\5\6" from being taken for the real record.
	let eocd = -1;
	for (let at = tail.length - EOCD_BYTES; at >= 0; at--) {
		if (tailView.getUint32(at, true) !== SIG_EOCD) continue;
		if (at + EOCD_BYTES + tailView.getUint16(at + 20, true) === tail.length) {
			eocd = at;
			break;
		}
	}
	if (eocd < 0) throw bad('it has no end-of-directory record');
	const eocdOffset = tailStart + eocd;

	let entryCount = tailView.getUint16(eocd + 10, true);
	let directorySize = tailView.getUint32(eocd + 12, true);
	let directoryOffset = tailView.getUint32(eocd + 16, true);
	const thisDisk = tailView.getUint16(eocd + 4, true);
	const directoryDisk = tailView.getUint16(eocd + 6, true);
	const entriesOnDisk = tailView.getUint16(eocd + 8, true);
	let boundary = eocdOffset;

	const isZip64 =
		entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff;
	if (isZip64) {
		if (eocdOffset < ZIP64_LOCATOR_BYTES) throw bad('its Zip64 locator is missing');
		const locator = await source.readRange(eocdOffset - ZIP64_LOCATOR_BYTES, ZIP64_LOCATOR_BYTES);
		const locatorView = new DataView(locator.buffer, locator.byteOffset, locator.byteLength);
		if (locatorView.getUint32(0, true) !== SIG_ZIP64_LOCATOR) throw bad('its Zip64 locator is missing');
		if (locatorView.getUint32(4, true) !== 0 || locatorView.getUint32(16, true) > 1) {
			throw bad('multi-disk archives are not supported');
		}
		const recordOffset = toSafeNumber(locatorView.getBigUint64(8, true), 'the Zip64 record offset');
		if (recordOffset + ZIP64_EOCD_BYTES > eocdOffset - ZIP64_LOCATOR_BYTES) {
			throw bad('its Zip64 record is outside the file');
		}
		const record = await source.readRange(recordOffset, ZIP64_EOCD_BYTES);
		const view = new DataView(record.buffer, record.byteOffset, record.byteLength);
		if (view.getUint32(0, true) !== SIG_ZIP64_EOCD) throw bad('its Zip64 record is malformed');
		if (view.getUint32(16, true) !== 0 || view.getUint32(20, true) !== 0) {
			throw bad('multi-disk archives are not supported');
		}
		const count = toSafeNumber(view.getBigUint64(32, true), 'the entry count');
		if (count !== toSafeNumber(view.getBigUint64(24, true), 'the entry count')) {
			throw bad('its entry counts disagree');
		}
		if (count > MAX_ZIP_ENTRIES) throw new PayloadTooLargeError('The archive has too many entries');
		entryCount = count;
		directorySize = toSafeNumber(view.getBigUint64(40, true), 'the directory size');
		directoryOffset = toSafeNumber(view.getBigUint64(48, true), 'the directory offset');
		boundary = recordOffset;
	} else if (thisDisk !== 0 || directoryDisk !== 0 || entriesOnDisk !== entryCount) {
		throw bad('multi-disk archives are not supported');
	}

	if (entryCount > config.maxEntries) throw new PayloadTooLargeError('The archive has too many entries');
	if (directorySize > config.maxDirectoryBytes) {
		throw new PayloadTooLargeError('The archive directory is too large');
	}
	if (directoryOffset + directorySize > boundary) throw bad('its directory is outside the file');
	if (entryCount * CENTRAL_HEADER_BYTES > directorySize) throw bad('its directory is too short');

	const directory = await source.readRange(directoryOffset, directorySize);
	if (directory.length !== directorySize) throw bad('its directory is truncated');
	const entries = parseEntries(directory, entryCount, directoryOffset);

	let totalUncompressedBytes = 0;
	for (const entry of entries) {
		totalUncompressedBytes += entry.uncompressedSize;
		if (totalUncompressedBytes > config.maxUncompressedBytes) {
			throw new PayloadTooLargeError('The archive expands to more than the size limit');
		}
		if (
			entry.method === ZIP_METHOD.deflate &&
			entry.uncompressedSize > config.ratioFloorBytes &&
			entry.uncompressedSize > entry.compressedSize * config.maxExpansionRatio
		) {
			throw new ValidationError(`The archive entry ${entry.name} expands too much to be safe`);
		}
	}

	assertNoOverlap(entries, directoryOffset);
	return { entries, centralDirectoryOffset: directoryOffset, totalUncompressedBytes };
}

function parseEntries(directory: Uint8Array, count: number, directoryOffset: number): ZipEntry[] {
	const view = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
	const entries: ZipEntry[] = [];
	let at = 0;
	for (let index = 0; index < count; index++) {
		if (at + CENTRAL_HEADER_BYTES > directory.length || view.getUint32(at, true) !== SIG_CENTRAL) {
			throw bad('its directory is malformed');
		}
		const flags = view.getUint16(at + 8, true);
		const method = view.getUint16(at + 10, true);
		const crc = view.getUint32(at + 16, true);
		let compressedSize = view.getUint32(at + 20, true);
		let uncompressedSize = view.getUint32(at + 24, true);
		const nameLength = view.getUint16(at + 28, true);
		const extraLength = view.getUint16(at + 30, true);
		const commentLength = view.getUint16(at + 32, true);
		const diskStart = view.getUint16(at + 34, true);
		let localHeaderOffset = view.getUint32(at + 42, true);
		const nameStart = at + CENTRAL_HEADER_BYTES;
		const extraStart = nameStart + nameLength;
		const next = extraStart + extraLength + commentLength;
		if (next > directory.length) throw bad('its directory is malformed');

		const rawName = directory.slice(nameStart, extraStart);
		if (nameLength === 0) throw bad('an entry has no name');
		if (flags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION | FLAG_MASKED_HEADERS)) {
			throw new ValidationError('The archive has an encrypted entry, which cannot be read');
		}
		if (method !== ZIP_METHOD.stored && method !== ZIP_METHOD.deflate) {
			throw new ValidationError(`The archive uses compression method ${method}, which is not supported`);
		}
		const name = decodeName(rawName, (flags & FLAG_UTF8_NAME) !== 0);

		// Zip64 stores a field in the extra block only when its 32-bit slot is saturated, and in a
		// fixed order, so the saturated ones are consumed in turn.
		const isSizeSaturated = uncompressedSize === 0xffffffff;
		const isCompressedSaturated = compressedSize === 0xffffffff;
		const isOffsetSaturated = localHeaderOffset === 0xffffffff;
		if (isSizeSaturated || isCompressedSaturated || isOffsetSaturated) {
			const extra = findZip64Extra(directory.subarray(extraStart, extraStart + extraLength));
			if (!extra) throw bad(`the Zip64 fields of ${name} are missing`);
			const extraView = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
			let cursor = 0;
			const take = () => {
				if (cursor + 8 > extra.length) throw bad(`the Zip64 fields of ${name} are short`);
				const value = toSafeNumber(extraView.getBigUint64(cursor, true), `a size of ${name}`);
				cursor += 8;
				return value;
			};
			if (isSizeSaturated) uncompressedSize = take();
			if (isCompressedSaturated) compressedSize = take();
			if (isOffsetSaturated) localHeaderOffset = take();
		}

		if (diskStart !== 0 && diskStart !== 0xffff) throw bad('multi-disk archives are not supported');
		if (method === ZIP_METHOD.stored && compressedSize !== uncompressedSize) {
			throw bad(`the sizes of the stored entry ${name} disagree`);
		}
		const isDirectory = name.endsWith('/');
		if (isDirectory && uncompressedSize !== 0) throw bad(`the folder ${name} has data`);

		entries.push({
			name,
			isDirectory,
			method,
			crc32: crc,
			compressedSize,
			uncompressedSize,
			localHeaderOffset,
			rawName,
			dataLimit: directoryOffset
		});
		at = next;
	}
	if (at !== directory.length) throw bad('its directory has trailing bytes');
	return entries;
}

function findZip64Extra(extra: Uint8Array): Uint8Array | null {
	const view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
	let at = 0;
	while (at + 4 <= extra.length) {
		const id = view.getUint16(at, true);
		const length = view.getUint16(at + 2, true);
		if (at + 4 + length > extra.length) return null;
		if (id === 0x0001) return extra.subarray(at + 4, at + 4 + length);
		at += 4 + length;
	}
	return null;
}

/**
 * Entries must not share bytes. An overlap is the way a zip makes one stored byte count for
 * several entries (the "quine" bomb), so it is refused outright. Only the fixed part of each extent
 * is known here (header, name, data); the local extra field and descriptor make the true extent
 * longer, so this under-detects, and `openEntry` re-checks against the real data offset.
 * Also fixes each entry's `dataLimit` to the start of whatever follows it.
 */
function assertNoOverlap(entries: ZipEntry[], directoryOffset: number): void {
	const sorted = [...entries].sort((a, b) => a.localHeaderOffset - b.localHeaderOffset);
	for (let index = 0; index < sorted.length; index++) {
		const entry = sorted[index];
		const minimumEnd =
			entry.localHeaderOffset + LOCAL_HEADER_BYTES + entry.rawName.length + entry.compressedSize;
		const limit = index + 1 < sorted.length ? sorted[index + 1].localHeaderOffset : directoryOffset;
		if (minimumEnd > limit) throw bad(`the entry ${entry.name} overlaps another`);
		entry.dataLimit = limit;
	}
}

/** CP437, the encoding zip assumes for a name without the UTF-8 flag, from 0x80 up. */
const CP437_HIGH =
	'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐' +
	'└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

function decodeName(raw: Uint8Array, isUtf8: boolean): string {
	if (isUtf8) {
		try {
			return new TextDecoder('utf-8', { fatal: true }).decode(raw);
		} catch {
			throw bad('an entry name is not valid UTF-8');
		}
	}
	let out = '';
	for (const byte of raw) out += byte < 0x80 ? String.fromCharCode(byte) : CP437_HIGH[byte - 0x80];
	return out;
}

/**
 * A stream of the entry's uncompressed bytes, checked as they pass: it errors with a
 * `ValidationError` if the bytes outrun the declared size, fall short of it, fail the CRC-32,
 * or expand past the ratio cap. The check is in the stream, so a consumer that stores the bytes
 * must treat a stream error as a failed entry and discard what it wrote.
 */
export async function openEntry(
	source: ZipSource,
	entry: ZipEntry,
	limits: Partial<ZipLimits> = {}
): Promise<ReadableStream<Uint8Array>> {
	const config = { ...DEFAULT_LIMITS, ...limits };
	if (entry.isDirectory) throw new ValidationError(`${entry.name} is a folder, not a file`);

	// The local header's lengths may differ from the directory's (writers pad the extra field), so
	// the data offset comes from the local header. The name must still match: a mismatch is how an
	// archive shows one entry to a scanner and another to an extractor.
	const header = await source.readRange(
		entry.localHeaderOffset,
		LOCAL_HEADER_BYTES + entry.rawName.length
	);
	if (header.length < LOCAL_HEADER_BYTES + entry.rawName.length) throw bad('an entry is truncated');
	const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
	if (view.getUint32(0, true) !== SIG_LOCAL) throw bad(`the entry ${entry.name} has no local header`);
	const localNameLength = view.getUint16(26, true);
	const extraLength = view.getUint16(28, true);
	const localName = header.subarray(LOCAL_HEADER_BYTES);
	if (
		localNameLength !== entry.rawName.length ||
		localName.some((byte, index) => byte !== entry.rawName[index])
	) {
		throw bad(`the entry ${entry.name} does not match its local header`);
	}

	const dataOffset = entry.localHeaderOffset + LOCAL_HEADER_BYTES + localNameLength + extraLength;
	if (dataOffset + entry.compressedSize > Math.min(entry.dataLimit, source.size)) {
		throw bad(`the data of ${entry.name} runs past its place in the file`);
	}

	const stored =
		entry.compressedSize === 0
			? emptyStream()
			: await source.readStream(dataOffset, entry.compressedSize);
	const raw = entry.method === ZIP_METHOD.stored ? stored : inflateRaw(stored, config);
	return verify(raw, entry, config);
}

function emptyStream(): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			controller.close();
		}
	});
}

/**
 * Deflate without a zlib wrapper. `DecompressionStream('deflate-raw')` is the intended path; fflate
 * is the fallback for a runtime that lacks it, kept to small input slices because fflate inflates
 * everything pushed before it reports any (see `INFLATE_SLICE_BYTES` in gedzip.ts).
 */
function inflateRaw(input: ReadableStream<Uint8Array>, config: ZipLimits): ReadableStream<Uint8Array> {
	if (!config.isNativeInflateDisabled && typeof DecompressionStream !== 'undefined') {
		return input.pipeThrough(new DecompressionStream('deflate-raw') as ReadableWritablePair<Uint8Array, Uint8Array>);
	}
	const SLICE_BYTES = 4 * 1024;
	const reader = input.getReader();
	const pending: Uint8Array[] = [];
	let isFinished = false;
	const inflate = new Inflate((chunk) => pending.push(chunk));
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			while (pending.length === 0 && !isFinished) {
				const { done, value } = await reader.read();
				try {
					if (done) {
						inflate.push(new Uint8Array(0), true);
						isFinished = true;
					} else {
						for (let at = 0; at < value.length; at += SLICE_BYTES) {
							inflate.push(value.subarray(at, at + SLICE_BYTES));
						}
					}
				} catch {
					controller.error(new TypeError('The deflate data is corrupt'));
					return;
				}
			}
			const next = pending.shift();
			if (next) controller.enqueue(next);
			else controller.close();
		},
		cancel: (reason) => reader.cancel(reason)
	});
}

/** Counts, checksums and bounds the bytes; any failure is a `ValidationError`. */
function verify(
	input: ReadableStream<Uint8Array>,
	entry: ZipEntry,
	config: ZipLimits
): ReadableStream<Uint8Array> {
	const reader = input.getReader();
	let count = 0;
	let crc = 0;
	const fail = (controller: ReadableStreamDefaultController<Uint8Array>, error: unknown) => {
		controller.error(
			error instanceof ValidationError
				? error
				: new ValidationError(`The archive entry ${entry.name} could not be read: it is corrupt or truncated`)
		);
		void reader.cancel().catch(() => undefined);
	};
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const { done, value } = await reader.read();
				if (done) {
					if (count !== entry.uncompressedSize) {
						throw new ValidationError(`The archive entry ${entry.name} is shorter than it declares`);
					}
					if (crc !== entry.crc32) {
						throw new ValidationError(`The archive entry ${entry.name} fails its checksum`);
					}
					controller.close();
					return;
				}
				count += value.length;
				if (count > entry.uncompressedSize) {
					throw new ValidationError(`The archive entry ${entry.name} is longer than it declares`);
				}
				if (
					count > config.ratioFloorBytes &&
					count > entry.compressedSize * config.maxExpansionRatio
				) {
					throw new ValidationError(`The archive entry ${entry.name} expands too much to be safe`);
				}
				crc = crc32Update(crc, value);
				controller.enqueue(value);
			} catch (error) {
				fail(controller, error);
			}
		},
		cancel: (reason) => reader.cancel(reason)
	});
}
