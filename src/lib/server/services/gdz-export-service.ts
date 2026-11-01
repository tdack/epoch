/**
 * The steps of a `.gdz` export with media (ADR-074 Phase 3, ADR-040). The archive is written as
 * segments, each its own R2 object: segment 0 is `gedcom.ged`, then one segment per batch of
 * files, then a tail holding the central directory. Joined in order they are one valid zip; the
 * download streams them and never merges them.
 *
 * Every step authorises again, because it runs later than the request. Every key derives from the
 * instance's tree and client uuid plus the segment number, so a retried step overwrites its own
 * object and writes identical bytes.
 */

import { strToU8 } from 'fflate';
import type { R2Bucket } from '@cloudflare/workers-types';
import type { DbClient } from '../db';
import { planArchiveFiles, type ArchivePlanEntry } from '../gedcom/archive-paths';
import { exportPayloadFrom } from '../gedcom/export-payload';
import { buildGedcomString } from '../gedcom/serializer';
import {
	deflateEntry,
	writeCentralDirectory,
	writeSegment,
	type ZipEntry,
	type ZipEntryRecord
} from '../gedcom/zip-writer';
import { fixedLengthBody } from '../http/fixed-length-body';
import { GedcomRepository } from '../repositories/gedcom-repository';
import { exportObjectKey, exportPlanKey, exportSegmentKey } from '../workflows/export-instance';
import { GedcomService } from './gedcom-service';

/** Media is included only up to these sizes (ADR-074); above them the archive holds the dataset alone. */
export const MEDIA_EXPORT_MAX_PEOPLE = 10_000;
export const MEDIA_EXPORT_MAX_FILES = 50_000;

/**
 * A media step copies at most this many files or bytes (a larger file gets a step of its own).
 * 100 files is about 200 R2 calls (a head and a get each), far below the 10,000 subrequests a step
 * may make, and 50,000 files is then 500 steps, under the 1,024 a Workflow instance may run. 64 MiB
 * is a few seconds of R2 transfer and a trivial CPU cost, so a retry repeats little. Neither bound
 * is memory: bytes stream through.
 */
export const MEDIA_BATCH_MAX_FILES = 100;
export const MEDIA_BATCH_MAX_BYTES = 64 * 1024 * 1024;
/** What a file with no recorded size counts for when batching; its real size is read at copy time. */
const UNKNOWN_SIZE_ESTIMATE_BYTES = 1024 * 1024;

/** What the dataset step decides and later steps read. Plain JSON in R2: it can exceed a step result. */
interface ExportPlan {
	filename: string;
	entries: ArchivePlanEntry[];
	/** Half-open `[from, to)` ranges into `entries`, one per media step. */
	batches: Array<[number, number]>;
}

/** What the download reads: written last, so its presence means every segment is in place. */
export interface SegmentedManifest {
	filename: string;
	/** Byte length of each segment in order. */
	lengths: number[];
}

export function manifestTotal(manifest: SegmentedManifest): number {
	return manifest.lengths.reduce((sum, n) => sum + n, 0);
}

function batchesOf(entries: readonly ArchivePlanEntry[]): Array<[number, number]> {
	const batches: Array<[number, number]> = [];
	let from = 0;
	let bytes = 0;
	entries.forEach((entry, i) => {
		const size = entry.size ?? UNKNOWN_SIZE_ESTIMATE_BYTES;
		if (i > from && (i - from >= MEDIA_BATCH_MAX_FILES || bytes + size > MEDIA_BATCH_MAX_BYTES)) {
			batches.push([from, i]);
			from = i;
			bytes = 0;
		}
		bytes += size;
	});
	if (entries.length > from) batches.push([from, entries.length]);
	return batches;
}

/** An R2 object's bytes as a stream, fetched when first read so only one body is open at a time. */
function objectStream(bucket: R2Bucket, key: string): ReadableStream<Uint8Array> {
	let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
	return new ReadableStream({
		async pull(controller) {
			if (!reader) {
				const object = await bucket.get(key);
				if (!object) throw new Error('A media object vanished while it was being copied');
				reader = (object.body as unknown as ReadableStream<Uint8Array>).getReader();
			}
			const { done: isDone, value } = await reader.read();
			if (isDone) controller.close();
			else controller.enqueue(value);
		},
		cancel: (reason) => reader?.cancel(reason)
	});
}

export class GdzExportService {
	private readonly auth: GedcomService;
	private readonly repo: GedcomRepository;

	constructor(
		db: DbClient,
		private readonly bucket: R2Bucket
	) {
		this.auth = new GedcomService(db);
		this.repo = new GedcomRepository(db);
	}

	private async putSegment(
		treeId: string,
		clientUuid: string,
		n: number,
		bytes: Uint8Array | { stream: ReadableStream<Uint8Array>; length: number },
		records: Promise<ZipEntryRecord[]> | ZipEntryRecord[]
	): Promise<void> {
		const key = exportSegmentKey(treeId, clientUuid, n);
		const customMetadata = { uploadedAt: new Date().toISOString() };
		await this.bucket.put(
			key,
			bytes instanceof Uint8Array ? bytes : fixedLengthBody(bytes.stream, bytes.length),
			{ customMetadata }
		);
		// After the bytes: a segment's records are known only once its stream has been consumed.
		await this.bucket.put(`${key}.json`, JSON.stringify(await records), { customMetadata });
	}

	private async readJson<T>(key: string): Promise<T> {
		const object = await this.bucket.get(key);
		if (!object) throw new Error('An export part is missing');
		return JSON.parse(await object.text()) as T;
	}

	/** Segment 0: `gedcom.ged`, the plan of files, and how many media steps follow. */
	async writeDataset(
		treeId: string,
		userId: string | undefined,
		clientUuid: string
	): Promise<{ length: number; batchCount: number }> {
		await this.auth.requireExporter(treeId, userId);
		const rows = await this.repo.loadExportRows(treeId);
		const files = rows.mediaFiles.filter((f) => f.status !== 'unresolved');
		const isMediaIncluded =
			rows.individuals.length <= MEDIA_EXPORT_MAX_PEOPLE && files.length <= MEDIA_EXPORT_MAX_FILES;
		const plan = planArchiveFiles(isMediaIncluded ? files : []);
		const data = exportPayloadFrom(treeId, rows, plan.fileTexts);
		const gedcom = buildGedcomString(data, 'gedcom7');

		const segment = writeSegment([deflateEntry('gedcom.ged', strToU8(gedcom))], 0);
		await this.putSegment(
			treeId,
			clientUuid,
			0,
			{ stream: segment.stream, length: segment.length! },
			segment.records
		);
		const batches = batchesOf(plan.entries);
		const base = data.treeName.replace(/[^a-zA-Z0-9_-]/g, '_');
		const stored: ExportPlan = { filename: `${base}.gdz`, entries: plan.entries, batches };
		await this.bucket.put(exportPlanKey(treeId, clientUuid), JSON.stringify(stored));
		return { length: segment.length!, batchCount: batches.length };
	}

	/**
	 * Media segment `index + 1`, starting at `startOffset` in the archive. Copying the bytes is the
	 * snapshot: a file gone by now is left out of the segment and so out of the directory.
	 */
	async writeMediaBatch(
		treeId: string,
		userId: string | undefined,
		clientUuid: string,
		index: number,
		startOffset: number
	): Promise<{ length: number }> {
		await this.auth.requireExporter(treeId, userId);
		const plan = await this.readJson<ExportPlan>(exportPlanKey(treeId, clientUuid));
		const range = plan.batches[index];
		if (!range) throw new Error('No such media batch');

		const zipEntries: ZipEntry[] = [];
		for (const entry of plan.entries.slice(range[0], range[1])) {
			const head = await this.bucket.head(entry.key);
			if (!head) continue;
			zipEntries.push({
				name: entry.name,
				data: objectStream(this.bucket, entry.key),
				compressedSize: head.size,
				// Absent: the writer computes it and writes a data descriptor.
				...(entry.crc32 === null ? {} : { crc32: entry.crc32 })
			});
		}
		const segment = writeSegment(zipEntries, startOffset);
		const length = segment.length!;
		await this.putSegment(
			treeId,
			clientUuid,
			index + 1,
			length === 0 ? new Uint8Array(0) : { stream: segment.stream, length },
			length === 0 ? [] : segment.records
		);
		return { length };
	}

	/** The central directory as the last segment, then the manifest that completes the export. */
	async writeTail(
		treeId: string,
		userId: string | undefined,
		clientUuid: string,
		lengths: readonly number[]
	): Promise<string> {
		await this.auth.requireExporter(treeId, userId);
		const plan = await this.readJson<ExportPlan>(exportPlanKey(treeId, clientUuid));
		const records: ZipEntryRecord[] = [];
		for (let n = 0; n < lengths.length; n++) {
			records.push(
				...(await this.readJson<ZipEntryRecord[]>(
					`${exportSegmentKey(treeId, clientUuid, n)}.json`
				))
			);
		}
		const cdOffset = lengths.reduce((sum, n) => sum + n, 0);
		const tail = writeCentralDirectory(records, cdOffset);
		await this.putSegment(treeId, clientUuid, lengths.length, tail, []);

		const manifest: SegmentedManifest = {
			filename: plan.filename,
			lengths: [...lengths, tail.byteLength]
		};
		const key = exportObjectKey(treeId, 'g7m', clientUuid);
		await this.bucket.put(key, JSON.stringify(manifest), {
			customMetadata: { uploadedAt: new Date().toISOString() }
		});
		return key;
	}
}
