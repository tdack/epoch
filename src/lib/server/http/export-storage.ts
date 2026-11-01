/**
 * Where an export's bytes live and how they leave: deleting one (a single object, or every part of
 * a segmented one) and streaming a segmented one to a client. Shared by the status, download and
 * start routes so they cannot disagree about what "gone" means.
 */

import type { R2Bucket } from '@cloudflare/workers-types';
import { ExportExpiredError, NotFoundError } from '../domain/errors';
import { manifestTotal, type SegmentedManifest } from '../services/gdz-export-service';
import {
	exportObjectKey,
	exportPartsPrefix,
	exportSegmentKey,
	exportWriteTime,
	isExportExpired,
	type ParsedExportInstance
} from '../workflows/export-instance';
import { fixedLengthBody } from './fixed-length-body';

/** R2 refuses a delete of more than this many keys. */
const MAX_DELETE_KEYS = 1000;

/**
 * Best-effort delete of everything an instance wrote. The key comes from the parsed id, never a
 * client. A segmented export is found by listing its prefix, which also catches the parts of one
 * that never finished. The lifecycle rule is the backstop if any call fails.
 */
export async function deleteExport(
	bucket: R2Bucket,
	parsed: ParsedExportInstance,
	/** The caller just read the object, so a single-object export need not be probed for first. */
	isKnownPresent = false
): Promise<void> {
	try {
		if (!parsed.shouldIncludeMedia) {
			const key = exportObjectKey(parsed.treeId, parsed.token, parsed.clientUuid);
			if (isKnownPresent || (await bucket.head(key))) await bucket.delete(key);
			return;
		}
		const prefix = exportPartsPrefix(parsed.treeId, parsed.clientUuid);
		let cursor: string | undefined;
		do {
			const page = await bucket.list({ prefix, cursor });
			const keys = page.objects.map((o) => o.key);
			for (let i = 0; i < keys.length; i += MAX_DELETE_KEYS) {
				await bucket.delete(keys.slice(i, i + MAX_DELETE_KEYS));
			}
			cursor = page.truncated ? page.cursor : undefined;
		} while (cursor);
	} catch {
		// The object is past use whether or not the delete lands: the lifecycle rule is the backstop.
	}
}

/**
 * The segments of a finished segmented export as one stream of exactly `length` bytes. Expired
 * means every part is deleted and `ExportExpiredError` thrown; a missing manifest is a 404. Expiry
 * is measured from the manifest, written last, so it is never earlier than any segment's.
 */
export async function openSegmentedExport(
	bucket: R2Bucket,
	parsed: ParsedExportInstance
): Promise<{ body: ReadableStream<Uint8Array>; length: number; filename: string }> {
	const manifestObject = await bucket.get(
		exportObjectKey(parsed.treeId, parsed.token, parsed.clientUuid)
	);
	if (!manifestObject) throw new NotFoundError('Export');
	if (isExportExpired(exportWriteTime(manifestObject))) {
		await deleteExport(bucket, parsed, true);
		throw new ExportExpiredError();
	}
	const manifest = JSON.parse(await manifestObject.text()) as SegmentedManifest;

	let index = 0;
	let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
	const joined = new ReadableStream<Uint8Array>({
		async pull(controller) {
			for (;;) {
				if (!reader) {
					if (index >= manifest.lengths.length) return controller.close();
					const segment = await bucket.get(
						exportSegmentKey(parsed.treeId, parsed.clientUuid, index)
					);
					if (!segment || segment.size !== manifest.lengths[index]) {
						return controller.error(new Error('An export segment is missing or changed'));
					}
					reader = (segment.body as unknown as ReadableStream<Uint8Array>).getReader();
				}
				const { done: isDone, value } = await reader.read();
				if (isDone) {
					reader = undefined;
					index++;
					continue;
				}
				return controller.enqueue(value);
			}
		},
		cancel: (reason) => reader?.cancel(reason)
	});
	const length = manifestTotal(manifest);
	return { body: fixedLengthBody(joined, length), length, filename: manifest.filename };
}
