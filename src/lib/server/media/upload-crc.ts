import { crc32Combine } from '../gedcom/crc32';
import type { UploadSessionRow } from '../repositories/upload-repository';
import { expectedPartBytes, uploadPartCount } from '../../shared/uploads';

/**
 * The CRC-32 of the whole assembled upload, folded from the per-part CRCs in part order, or null
 * when any part has none (a session opened before CRCs were kept). Derived from the session row on
 * demand rather than stored at complete, so the file-recording step needs nothing passed to it.
 */
export function combinedPartCrc32(
	session: Pick<UploadSessionRow, 'partCrcs' | 'totalBytes' | 'partSizeBytes'>
): number | null {
	const count = uploadPartCount(session.totalBytes, session.partSizeBytes);
	let crc = 0;
	for (let n = 1; n <= count; n++) {
		const partCrc = session.partCrcs[String(n)];
		if (partCrc === undefined) return null;
		const length = expectedPartBytes(n, session.totalBytes, session.partSizeBytes);
		crc = crc32Combine(crc, partCrc, length);
	}
	return crc;
}
