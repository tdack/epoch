/**
 * GEDZip: a GEDCOM 7 dataset in a zip archive as `gedcom.ged`, beside the media it refers to.
 * Epoch exports no media yet, so an archive it writes holds the dataset alone.
 */

import { strToU8, unzipSync, zipSync } from 'fflate';
import { ValidationError } from '../domain/errors';

/** The entry the GEDZip chapter of the 7.0 specification requires. */
const DATASET_ENTRY = 'gedcom.ged';

/** The media type IANA registered for GEDZip. */
export const GEDZIP_CONTENT_TYPE = 'application/vnd.familysearch.gedcom+zip';

/** True when the bytes start with a zip local file header. */
export function isZip(bytes: Uint8Array): boolean {
	return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

export function packGedzip(gedcom: string): Uint8Array {
	return zipSync({ [DATASET_ENTRY]: strToU8(gedcom) });
}

/** The dataset's bytes from a GEDZip archive. Throws a `ValidationError` when it has none. */
export function unpackGedzip(bytes: Uint8Array): Uint8Array {
	let entries: Record<string, Uint8Array>;
	try {
		entries = unzipSync(bytes, { filter: (file) => file.name === DATASET_ENTRY });
	} catch {
		throw new ValidationError('The archive could not be read as a zip file');
	}
	const dataset = entries[DATASET_ENTRY];
	if (!dataset) throw new ValidationError(`The archive has no ${DATASET_ENTRY}`);
	return dataset;
}
