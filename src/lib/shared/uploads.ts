import { MAX_MEDIA_FILE_BYTES, MAX_TREE_MEDIA_BYTES } from './media';

/**
 * Resumable upload sessions (ADR-074). A file goes up in fixed-size parts, each one a request of
 * its own, so no request approaches the Worker's body limit (100 MB on the plans that matter).
 */

/**
 * Every part but the last is exactly this long, which is what R2 multipart requires and lets a
 * part's offset be derived from its number. Well under the 100 MB request limit, over R2's 5 MiB
 * minimum, and 10,000 parts reach about 488 GiB.
 */
export const UPLOAD_PART_BYTES = 50 * 1024 * 1024;

/**
 * The dataset inside a `.gdz`, once unpacked. Mirrors `MAX_DATASET_BYTES` in the server's GEDCOM
 * limits, which `shared/` may not import; `uploads.test.ts` fails if the two drift.
 */
export const GEDZIP_DATASET_BYTES = 50 * 1024 * 1024;

/** A `.gdz` holds a tree's media plus its dataset, so it may be as large as both together. */
export const MAX_GEDZIP_UPLOAD_BYTES = MAX_TREE_MEDIA_BYTES + GEDZIP_DATASET_BYTES;

export const UPLOAD_PURPOSES = ['gedzip_import', 'media'] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

/**
 * The largest file each purpose may upload. Media is checked against the quota as well, so a file
 * under its cap is still refused when the tree has less room.
 */
export const MAX_UPLOAD_BYTES_BY_PURPOSE: Record<UploadPurpose, number> = {
	gedzip_import: MAX_GEDZIP_UPLOAD_BYTES,
	media: MAX_MEDIA_FILE_BYTES
};

/** How long an open session lives. A sweep aborts the R2 upload of one left past this. */
export const UPLOAD_SESSION_TTL_SECONDS = 24 * 60 * 60;

/** `POST /api/uploads` response. `parts[].url` is chosen by the server; clients must not build it. */
export interface UploadSessionDto {
	sessionId: string;
	partSizeBytes: number;
	partCount: number;
	parts: Array<{ partNumber: number; url: string; method: 'PUT' }>;
	/** Epoch milliseconds. */
	expiresAt: number;
}

/**
 * `GET /api/uploads/:id` response: the session as it was opened plus the parts the server holds,
 * so a reloaded page can resume without re-sending them.
 */
export interface UploadSessionStateDto extends UploadSessionDto {
	receivedParts: number[];
}

/** `PUT` response for one part. */
export interface UploadPartDto {
	partNumber: number;
	etag: string;
}

/** `POST /api/uploads/:id/complete` response. */
export interface UploadCompleteDto {
	sessionId: string;
	r2Key: string;
	totalBytes: number;
}

/** How many parts a file of this size needs; 0 bytes is refused before this is asked. */
export function uploadPartCount(totalBytes: number, partSizeBytes = UPLOAD_PART_BYTES): number {
	return Math.ceil(totalBytes / partSizeBytes);
}

/** The byte length part `partNumber` (1-based) must have. */
export function expectedPartBytes(
	partNumber: number,
	totalBytes: number,
	partSizeBytes = UPLOAD_PART_BYTES
): number {
	const count = uploadPartCount(totalBytes, partSizeBytes);
	return partNumber < count ? partSizeBytes : totalBytes - partSizeBytes * (count - 1);
}
