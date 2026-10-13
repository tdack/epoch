/**
 * GEDZip: a GEDCOM 7 dataset in a zip archive as `gedcom.ged`, beside the media it refers to.
 * Epoch exports no media yet, so an archive it writes holds the dataset alone.
 */

import { strToU8, Unzip, UnzipInflate, zipSync } from 'fflate';
import { PayloadTooLargeError, ValidationError } from '../domain/errors';
import { MAX_DATASET_BYTES } from './limits';

/** The entry the GEDZip chapter of the 7.0 specification requires. */
const DATASET_ENTRY = 'gedcom.ged';

/**
 * How much of the archive is handed to the inflater at once. fflate inflates everything it is given
 * before it reports any of it, and deflate expands up to about 1032:1, so one push of the whole
 * archive lets a 25 MB upload allocate gigabytes before the byte count below can object. A push of
 * this size inflates to a few megabytes at most, which is what makes the cap hold.
 */
const INFLATE_SLICE_BYTES = 4 * 1024;

/** The media type IANA registered for GEDZip. */
export const GEDZIP_CONTENT_TYPE = 'application/vnd.familysearch.gedcom+zip';

/** True when the bytes start with a zip local file header. */
export function isZip(bytes: Uint8Array): boolean {
	return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

export function packGedzip(gedcom: string): Uint8Array<ArrayBuffer> {
	// fflate allocates a plain ArrayBuffer; its types only say ArrayBufferLike, which a Response body refuses.
	return zipSync({ [DATASET_ENTRY]: strToU8(gedcom) }) as Uint8Array<ArrayBuffer>;
}

/**
 * The dataset's bytes from a GEDZip archive. Throws a `ValidationError` when it has none, and a
 * `PayloadTooLargeError` when the dataset would exceed `maxDatasetBytes`.
 *
 * The archive is inflated as a stream and counted as it comes out, rather than with `unzipSync`.
 * Each entry's declared uncompressed size is written by the archive itself, so an attacker controls
 * it: `unzipSync` sizes its output from that value, then grows past it, and a size check made after
 * it returns runs only once the memory is spent. The declared size is still checked first, so an
 * honest over-large entry is refused before any inflating; the streamed count, fed in small slices
 * (`INFLATE_SLICE_BYTES`), is what actually bounds the output.
 */
export function unpackGedzip(bytes: Uint8Array, maxDatasetBytes = MAX_DATASET_BYTES): Uint8Array {
	const chunks: Uint8Array[] = [];
	let datasetBytes = 0;
	let isDatasetFound = false;

	const unzipper = new Unzip((file) => {
		if (file.name !== DATASET_ENTRY) return;
		if (isDatasetFound) throw new ValidationError(`The archive has more than one ${DATASET_ENTRY}`);
		isDatasetFound = true;
		if (file.originalSize !== undefined && file.originalSize > maxDatasetBytes) {
			throw new PayloadTooLargeError(`The dataset exceeds the ${maxDatasetBytes} byte limit`);
		}
		file.ondata = (error, chunk) => {
			if (error) throw error;
			datasetBytes += chunk.byteLength;
			if (datasetBytes > maxDatasetBytes) {
				throw new PayloadTooLargeError(`The dataset exceeds the ${maxDatasetBytes} byte limit`);
			}
			chunks.push(chunk);
		};
		file.start();
	});
	unzipper.register(UnzipInflate);

	try {
		for (let offset = 0; offset < bytes.length; offset += INFLATE_SLICE_BYTES) {
			const end = offset + INFLATE_SLICE_BYTES;
			unzipper.push(bytes.subarray(offset, end), end >= bytes.length);
		}
	} catch (err) {
		if (err instanceof PayloadTooLargeError || err instanceof ValidationError) throw err;
		throw new ValidationError('The archive could not be read as a zip file');
	}
	if (!isDatasetFound) throw new ValidationError(`The archive has no ${DATASET_ENTRY}`);

	// Joining copies the chunks, so each is released as it is copied: the isolate holds 128 MB, and a
	// full-size dataset held twice would not fit beside the archive.
	const dataset = new Uint8Array(datasetBytes);
	let offset = 0;
	while (chunks.length > 0) {
		const chunk = chunks.shift() as Uint8Array;
		dataset.set(chunk, offset);
		offset += chunk.byteLength;
	}
	// Redundant with the streamed count above; kept so the cap does not rest on that count alone.
	if (dataset.byteLength > maxDatasetBytes) {
		throw new PayloadTooLargeError(`The dataset exceeds the ${maxDatasetBytes} byte limit`);
	}
	return dataset;
}
