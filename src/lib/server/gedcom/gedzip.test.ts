import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { PayloadTooLargeError, ValidationError } from '../domain/errors';
import { decodeGedcomFile } from './decode';
import { packGedzip, unpackGedzip } from './gedzip';
import { MAX_DATASET_BYTES } from './limits';

// Records the size of every piece the inflater reports, so a test can see how much one push
// produced. The real class does the work.
const reportedChunkBytes: number[] = [];
vi.mock('fflate', async (importOriginal) => {
	const actual = await importOriginal<typeof import('fflate')>();
	class RecordingUnzip extends actual.Unzip {
		constructor(onFile: ConstructorParameters<typeof actual.Unzip>[0]) {
			super((file) => {
				onFile?.(file);
				const ondata = file.ondata;
				file.ondata = (error, chunk, isFinal) => {
					if (chunk) reportedChunkBytes.push(chunk.byteLength);
					ondata?.(error, chunk, isFinal);
				};
			});
		}
	}
	return { ...actual, Unzip: RecordingUnzip };
});

const GEDCOM = '0 HEAD\r\n1 GEDC\r\n2 VERS 7.0\r\n0 @I1@ INDI\r\n1 NAME Zoë /Ng/\r\n0 TRLR\r\n';

/** Overwrite a little-endian u32 at every place a zip records a size, so the header lies. */
function declareSmaller(archive: Uint8Array, declaredBytes: number): Uint8Array {
	const patched = archive.slice();
	const view = new DataView(patched.buffer);
	const LOCAL_SIGNATURE = 0x04034b50;
	const CENTRAL_SIGNATURE = 0x02014b50;
	for (let i = 0; i + 4 <= patched.length; i++) {
		const signature = view.getUint32(i, true);
		if (signature === LOCAL_SIGNATURE) view.setUint32(i + 22, declaredBytes, true);
		if (signature === CENTRAL_SIGNATURE) view.setUint32(i + 24, declaredBytes, true);
	}
	return patched;
}

describe('unpackGedzip', () => {
	it('unpacks a small GEDZip to its dataset', () => {
		const dataset = unpackGedzip(packGedzip(GEDCOM));
		expect(new TextDecoder().decode(dataset)).toBe(GEDCOM);
	});

	it('still imports a small GEDZip and a plain .ged through the decoder', () => {
		expect(decodeGedcomFile(packGedzip(GEDCOM))).toBe(GEDCOM);
		expect(decodeGedcomFile(strToU8(GEDCOM))).toBe(GEDCOM);
	});

	it('refuses an archive with no gedcom.ged', () => {
		const archive = zipSync({ 'other.txt': strToU8('x') });
		expect(() => unpackGedzip(archive)).toThrow(ValidationError);
	});

	it('refuses bytes that are not a zip archive', () => {
		expect(() => unpackGedzip(strToU8('not a zip at all, just text'))).toThrow(ValidationError);
	});

	it('refuses a dataset over the cap, judged by its real size and not its declared one', () => {
		const archive = packGedzip(GEDCOM);
		const cap = GEDCOM.length - 1;
		expect(() => unpackGedzip(archive, cap)).toThrow(PayloadTooLargeError);
	});

	it('refuses a dataset whose header declares it small but which inflates past the cap', () => {
		const lying = declareSmaller(packGedzip(GEDCOM), 1);
		// The declared size must really be the small one, or this would only test the header check.
		let declared = -1;
		unzipSync(lying, {
			filter: (file) => {
				declared = file.originalSize;
				return false;
			}
		});
		expect(declared).toBe(1);
		expect(() => unpackGedzip(lying, GEDCOM.length - 1)).toThrow(PayloadTooLargeError);
	});

	it('refuses a highly compressible dataset just over the real cap', () => {
		// Fifty mebibytes of zeros deflate to a few tens of kilobytes: a small archive that expands
		// past the cap, which is the case the cap exists for.
		const bomb = zipSync({ 'gedcom.ged': new Uint8Array(MAX_DATASET_BYTES + 1) });
		expect(bomb.byteLength).toBeLessThan(1024 * 1024);
		expect(() => unpackGedzip(bomb)).toThrow(PayloadTooLargeError);
	}, 30_000);

	it('stops a bomb whose header lies before it inflates far past the cap', () => {
		// Twenty mebibytes of zeros declared as one byte: only the streamed count can catch it, and it
		// must catch it while a single push is still small. Pushing the archive whole would report one
		// 20 MiB chunk here. 4 KiB of deflate expands at most about 1032:1.
		const cap = 1024 * 1024;
		const lying = declareSmaller(zipSync({ 'gedcom.ged': new Uint8Array(20 * 1024 * 1024) }), 1);
		reportedChunkBytes.length = 0;
		expect(() => unpackGedzip(lying, cap)).toThrow(PayloadTooLargeError);
		expect(Math.max(...reportedChunkBytes)).toBeLessThanOrEqual(cap + 4 * 1024 * 1032);
	}, 30_000);

	it('keeps the specific error for a second gedcom.ged', () => {
		const twice = new Uint8Array([...packGedzip(GEDCOM), ...packGedzip(GEDCOM)]);
		expect(() => unpackGedzip(twice)).toThrow(/more than one gedcom\.ged/);
	});
});
