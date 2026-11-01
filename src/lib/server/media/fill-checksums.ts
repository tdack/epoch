import type { R2Bucket } from '@cloudflare/workers-types';
import { and, eq, isNull, like, not, or, sql } from 'drizzle-orm';
import type { DbClient } from '../db';
import { mediaItems } from '../db/schema';
import { crc32Update } from '../gedcom/crc32';

export interface FillChecksumsResult {
	/** Rows given both checksums this run. */
	filled: number;
	/** Rows whose object was missing or unreadable; left null and retried by a later run. */
	skipped: number;
}

/**
 * Objects one scheduled run may read. A scheduled invocation gets 30 s of CPU. SHA-256 is native
 * and costs next to nothing, but the CRC is JavaScript at roughly 200-400 MB/s, so the CPU
 * spent is set by bytes, not files: `CHECKSUM_FILL_BATCH_BYTES` bounds that (256 MiB is about a
 * second or two). The file count bound keeps the D1 writes and R2 subrequests small whatever the
 * sizes; 5 files of at most the legacy 25 MiB cap each is well inside both. The run shares its
 * invocation with the upload sweep.
 */
export const CHECKSUM_FILL_BATCH_SIZE = 5;
export const CHECKSUM_FILL_BATCH_BYTES = 256 * 1024 * 1024;

const hexOf = (digest: ArrayBuffer): string =>
	[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Streams one object once, folding each chunk into both checksums. Throws if the stream fails.
 * `crypto.DigestStream` is Workers-only; it accepts the chunks and resolves to the digest.
 */
async function checksumsOf(
	body: ReadableStream<Uint8Array>
): Promise<{ sha256: string; crc32: number }> {
	const digestStream = new (
		crypto as unknown as { DigestStream: new (algorithm: string) => DigestStreamLike }
	).DigestStream('SHA-256');
	const writer = digestStream.getWriter();
	const reader = body.getReader();
	let crc = 0;
	for (;;) {
		const { done: isDone, value } = await reader.read();
		if (isDone) break;
		crc = crc32Update(crc, value);
		await writer.write(value);
	}
	await writer.close();
	return { sha256: hexOf(await digestStream.digest), crc32: crc };
}

interface DigestStreamLike extends WritableStream<Uint8Array> {
	readonly digest: Promise<ArrayBuffer>;
}

/**
 * Computes the SHA-256 and CRC-32 of resolved files that lack either (ADR-082), reading each object
 * once. Both columns are caches and, like `size_bytes`, are written straight to the row: no change
 * log entry, no version bump. Idempotent: a filled row is no longer selected. An unresolved row has
 * no object (its key is a placeholder) and is never touched. A row whose object is gone, or too
 * big for `maxBytes`, is skipped.
 */
export async function fillMissingChecksums(
	db: DbClient,
	bucket: R2Bucket,
	options: { limit: number; maxBytes?: number }
): Promise<FillChecksumsResult> {
	const rows = await db
		.select({ id: mediaItems.id, key: mediaItems.r2ObjectKey })
		.from(mediaItems)
		.where(
			and(
				or(isNull(mediaItems.status), eq(mediaItems.status, 'resolved')),
				not(like(mediaItems.r2ObjectKey, 'unresolved/%')),
				or(isNull(mediaItems.sha256), isNull(mediaItems.crc32))
			)
		)
		// Random, not by id: a row whose object is gone stays selected, and a fixed order would let a
		// few of them fill every batch and starve the rows behind them.
		.orderBy(sql`random()`)
		.limit(options.limit);
	let filled = 0;
	let skipped = 0;
	let remainingBytes = options.maxBytes ?? Number.POSITIVE_INFINITY;
	for (const row of rows) {
		try {
			const object = await bucket.get(row.key);
			if (!object) {
				skipped++;
				continue;
			}
			// Over what is left of the byte budget: left for a later run or the backfill script, which
			// has no CPU limit. A file larger than the whole budget is only ever the script's.
			if (object.size > remainingBytes) {
				await object.body.cancel().catch(() => undefined);
				skipped++;
				continue;
			}
			remainingBytes -= object.size;
			const sums = await checksumsOf(object.body as unknown as ReadableStream<Uint8Array>);
			await db
				.update(mediaItems)
				.set({ sha256: sums.sha256, crc32: sums.crc32 })
				.where(eq(mediaItems.id, row.id));
			filled++;
		} catch (err) {
			skipped++;
			console.error(`Could not checksum ${row.key}:`, err);
		}
	}
	return { filled, skipped };
}
