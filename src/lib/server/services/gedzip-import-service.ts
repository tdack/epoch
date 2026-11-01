/**
 * Importing a `.gdz` from a finished upload session (ADR-074 Phase 2, ADR-082). The archive stays in
 * R2; the Workflow calls these methods as separate steps: the dataset first, then the media in
 * batches, then a close. Every method re-checks that the requester still holds `tree:import`,
 * because a step may run hours after the request that started it.
 */

import type { R2Bucket, ReadableStream as WorkersReadableStream } from '@cloudflare/workers-types';
import type { DbClient } from '../db';
import {
	ConcurrencyConflictError,
	NotFoundError,
	PayloadTooLargeError,
	UnauthorizedError,
	ValidationError
} from '../domain/errors';
import type { AuthenticatedContext } from '../domain/identity';
import { decodeGedcomFile } from '../gedcom/decode';
import {
	classifyMediaEntry,
	indexEntryNames,
	isReservedEntryName,
	resolveFileReference
} from '../gedcom/gedzip-paths';
import type { ImportMode, ImportPreview } from '../gedcom/import-preview';
import { parseGedcom } from '../gedcom/parser';
import { MAX_DATASET_BYTES } from '../gedcom/limits';
import {
	openEntry,
	r2ZipSource,
	readCentralDirectory,
	type ZipEntry,
	type ZipSource
} from '../gedcom/zip-reader';
import { fixedLengthBody } from '../http/fixed-length-body';
import { sniffMediaType } from '../media/media-type';
import { sumStoredBytes } from '../media/stored-bytes';
import { ImportJobRepository } from '../repositories/import-job-repository';
import { MediaRepository } from '../repositories/media-repository';
import { UploadRepository } from '../repositories/upload-repository';
import { UserRepository } from '../repositories/user-repository';
import {
	isUploadMediaType,
	MAX_MEDIA_FILE_BYTES,
	MAX_TREE_MEDIA_BYTES,
	type GedzipMediaPreview
} from '../../shared/media';
import {
	GedcomService,
	type GedcomBindings,
	type GedzipMediaCounts,
	type ImportCounts,
	type ImportQueueMessage
} from './gedcom-service';
import { requireMemberAction, requireTreeAction } from './tree-access';

/**
 * Entries one media step handles at most. A step may make 10,000 subrequests; an entry costs about
 * five (two ranged reads, the put, a D1 write and the stream's own reads), plus a few per step for
 * the directory and the quota listing, so 100 entries stay near 500, far from the limit.
 */
const MEDIA_BATCH_ENTRIES = 100;

/**
 * Entry bytes one media step handles at most (a single larger entry still goes alone, up to
 * `MAX_MEDIA_FILE_BYTES`). Inflate is native but the CRC-32 is JavaScript at 200-400 MB/s, so
 * 256 MiB is a second or two of CPU against a step's 30 s default, leaving room for hashing in R2
 * and for slow chunks. Same figure as the checksum fill, for the same reason.
 */
const MEDIA_BATCH_BYTES = 256 * 1024 * 1024;

/** Enough for every magic number `sniffMediaType` reads, including a HEIF brand list. */
const SNIFF_BYTES = 256;

export const EMPTY_MEDIA_COUNTS: GedzipMediaCounts = {
	resolved: 0,
	unresolved: 0,
	detachedAdded: 0,
	skippedByType: 0,
	overCap: 0,
	overQuota: 0,
	unreadable: 0
};

/** True for the key an upload session gives a file of this tree, and nothing else. */
export const isUploadKeyOf = (treeId: string, key: string) => {
	const prefix = `staging/uploads/${treeId}/`;
	return key.startsWith(prefix) && key.length > prefix.length && !key.includes('/', prefix.length);
};

export interface GedzipImportInput {
	mode: ImportMode;
	shouldMergeDuplicateFamilies: boolean;
}

export interface MediaBatchResult {
	/** Index of the next entry to handle, or null when the archive is done. */
	next: number | null;
	/** Entries in the archive that can hold media, so a caller can say how far along it is. */
	total: number;
	counts: GedzipMediaCounts;
}

/** Splits the head off a stream so the type can be sniffed, then hands the whole stream back. */
async function peek(
	stream: ReadableStream<Uint8Array>
): Promise<{ head: Uint8Array; body: ReadableStream<Uint8Array> }> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let length = 0;
	let isDone = false;
	while (length < SNIFF_BYTES) {
		const read = await reader.read();
		if (read.done) {
			isDone = true;
			break;
		}
		chunks.push(read.value);
		length += read.value.length;
	}
	const head = new Uint8Array(length);
	let at = 0;
	for (const chunk of chunks) {
		head.set(chunk, at);
		at += chunk.length;
	}
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(chunk);
			if (isDone) controller.close();
		},
		async pull(controller) {
			const read = await reader.read();
			if (read.done) controller.close();
			else controller.enqueue(read.value);
		},
		cancel: (reason) => reader.cancel(reason)
	});
	return { head, body };
}

/** A stable id for the detached object of an entry, so a retry after a crash reuses its R2 key. */
async function detachedId(treeId: string, entryName: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(`${treeId}\n${entryName}`)
	);
	const h = [...new Uint8Array(digest).slice(0, 16)]
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export class GedzipImportService {
	private readonly users: UserRepository;
	private readonly media: MediaRepository;
	private readonly jobs: ImportJobRepository;
	private readonly uploads: UploadRepository;

	constructor(
		private readonly db: DbClient,
		private readonly bindings: GedcomBindings = {}
	) {
		this.users = new UserRepository(db);
		this.media = new MediaRepository(db);
		this.jobs = new ImportJobRepository(db);
		this.uploads = new UploadRepository(db);
	}

	/**
	 * Starts the Workflow for a completed `gedzip_import` session. The archive key is the session
	 * row's, never the client's; only the session's creator may start it, into the session's tree.
	 * The session is claimed with one conditional update, so a double click starts one import.
	 */
	async start(
		sessionId: string,
		input: GedzipImportInput,
		context: AuthenticatedContext
	): Promise<{ status: 'queued'; treeId: string; jobId: string }> {
		const { bucket, importWorkflow } = this.bindings;
		if (!bucket || !importWorkflow) throw new Error('Import workflow binding unavailable');
		const session = await this.ownedSession(sessionId, context);

		if (!(await this.uploads.claimForImport(session.id))) {
			throw new ConcurrencyConflictError('This upload has already been imported');
		}

		const jobId = crypto.randomUUID();
		const message: ImportQueueMessage = {
			treeId: session.treeId,
			r2ObjectKey: session.r2Key,
			mode: input.mode,
			shouldMergeDuplicateFamilies: input.shouldMergeDuplicateFamilies,
			actorId: context.user.id,
			isArchive: true
		};
		try {
			await this.jobs.create({
				id: jobId,
				treeId: session.treeId,
				r2ObjectKey: session.r2Key,
				createdBy: context.user.id
			});
			await importWorkflow.create({
				id: jobId,
				params: message,
				retention: { successRetention: '3 days', errorRetention: '7 days' }
			});
		} catch (err) {
			await bucket.delete(session.r2Key).catch(() => undefined);
			await this.jobs.fail(jobId, 'The import could not be started.').catch(() => undefined);
			throw err;
		}
		return { status: 'queued', treeId: session.treeId, jobId };
	}

	/**
	 * The session's own `gedzip_import` upload, still waiting to be imported. Only its creator sees
	 * it, and only while they hold `tree:import`; anyone else gets the same 404 as for a missing id.
	 */
	private async ownedSession(sessionId: string, context: AuthenticatedContext) {
		const session = await this.uploads.find(sessionId);
		if (!session || session.createdBy !== context.user.id || session.purpose !== 'gedzip_import') {
			throw new NotFoundError('Upload');
		}
		await requireTreeAction(this.users, session.treeId, context, 'tree:import');
		if (session.status === 'imported') {
			throw new ConcurrencyConflictError('This upload has already been imported');
		}
		if (session.status !== 'complete') throw new ValidationError('This upload is not finished');
		return session;
	}

	/**
	 * What importing this archive would do, before anything is written: the dataset's usual preview
	 * plus the media it would store. Reads the central directory and `gedcom.ged` only. A `FILE`
	 * counts once per mention, an entry once however many name it.
	 */
	async preview(
		sessionId: string,
		context: AuthenticatedContext
	): Promise<ImportPreview & { media: GedzipMediaPreview }> {
		const { bucket } = this.bindings;
		if (!bucket) throw new Error('Storage binding unavailable');
		const session = await this.ownedSession(sessionId, context);
		const source = await r2ZipSource(bucket, session.r2Key);
		const directory = await readCentralDirectory(source);
		const { names } = indexEntryNames(directory.entries.map((e) => e.name));
		const dataset = directory.entries.find((e) => e.name === 'gedcom.ged');
		if (!dataset) throw new ValidationError('The archive has no gedcom.ged');
		if (dataset.uncompressedSize > MAX_DATASET_BYTES) {
			throw new PayloadTooLargeError(`The dataset exceeds the ${MAX_DATASET_BYTES} byte limit`);
		}
		const text = decodeGedcomFile(
			new Uint8Array(await new Response(await openEntry(source, dataset)).arrayBuffer())
		);
		const parsed = parseGedcom(text);
		const dataPreview = await new GedcomService(this.db).previewParsed(session.treeId, parsed);

		const entryNames = new Set(names.keys());
		const entries = new Map(directory.entries.map((e) => [e.name, e]));
		const media: GedzipMediaPreview = {
			entryCount: 0,
			totalBytes: 0,
			quotaRemainingBytes: Math.max(
				0,
				MAX_TREE_MEDIA_BYTES - (await sumStoredBytes(bucket, `media/${session.treeId}/`))
			),
			resolvableFiles: 0,
			unresolvedFiles: 0,
			extraEntries: 0,
			skippedByType: 0,
			overCap: 0
		};
		// Entries the import would store; a `FILE` naming any other entry stays without bytes.
		const storable = new Set<string>();
		for (const name of entryNames) {
			const entry = entries.get(name);
			if (!entry || entry.isDirectory || isReservedEntryName(name)) continue;
			if (classifyMediaEntry(name).kind !== 'media') media.skippedByType++;
			else if (entry.uncompressedSize > MAX_MEDIA_FILE_BYTES) media.overCap++;
			else {
				storable.add(name);
				media.entryCount++;
				media.totalBytes += entry.uncompressedSize;
			}
		}
		const named = new Set<string>();
		for (const file of parsed.media.flatMap((m) => m.files)) {
			const ref = resolveFileReference(file.path, entryNames);
			if (ref.kind === 'entry' && storable.has(ref.name)) {
				media.resolvableFiles++;
				named.add(ref.name);
			} else media.unresolvedFiles++;
		}
		media.extraEntries = storable.size - named.size;
		return { ...dataPreview, media };
	}

	/** Reads `gedcom.ged` out of the archive and imports it; media rows come out unresolved. */
	async importDataset(message: ImportQueueMessage): Promise<ImportCounts> {
		const { source, directory } = await this.open(message);
		const entry = directory.entries.find((e) => e.name === 'gedcom.ged');
		if (!entry) throw new ValidationError('The archive has no gedcom.ged');
		if (entry.uncompressedSize > MAX_DATASET_BYTES) {
			throw new PayloadTooLargeError(`The dataset exceeds the ${MAX_DATASET_BYTES} byte limit`);
		}
		const bytes = new Uint8Array(await new Response(await openEntry(source, entry)).arrayBuffer());
		return new GedcomService(this.db).runImport(
			message.treeId,
			decodeGedcomFile(bytes),
			message.treeName,
			message.mode ?? 'replace',
			{
				shouldMergeDuplicateFamilies: message.shouldMergeDuplicateFamilies,
				actorId: message.actorId
			}
		);
	}

	/**
	 * Stores one batch of entries from `cursor` and says where the next begins. Safe to run again:
	 * a file already resolved is not in the work list, and every object key is fixed by its row id.
	 */
	async importMediaBatch(message: ImportQueueMessage, cursor: number): Promise<MediaBatchResult> {
		const { treeId } = message;
		const { source, directory, names } = await this.open(message);
		const entryNames = new Set(names.keys());
		const entries = directory.entries.filter((e) => !e.isDirectory && !isReservedEntryName(e.name));

		// Which files each entry serves. A file whose path is exactly an entry's name counts too: that
		// is how a detached object from an earlier run (or a name `FILE` syntax cannot spell) is found.
		const filesByEntry = new Map<string, Array<{ id: string; status: string | null }>>();
		for (const file of await this.media.filesWithPath(treeId)) {
			const ref = resolveFileReference(file.gedcomPath, entryNames);
			const name =
				ref.kind === 'entry' ? ref.name : entryNames.has(file.gedcomPath) ? file.gedcomPath : null;
			if (name !== null) filesByEntry.set(name, [...(filesByEntry.get(name) ?? []), file]);
		}

		const counts = { ...EMPTY_MEDIA_COUNTS };
		let stored = await sumStoredBytes(this.bindings.bucket!, `media/${treeId}/`);
		let batchBytes = 0;
		let at = cursor;
		for (; at < entries.length && at - cursor < MEDIA_BATCH_ENTRIES; at++) {
			const entry = entries[at];
			const files = filesByEntry.get(entry.name) ?? [];
			const targets = files.filter((f) => f.status === 'unresolved').map((f) => f.id);
			const isDetached = files.length === 0;
			if (targets.length === 0 && !isDetached) continue;

			if (!names.has(entry.name) || classifyMediaEntry(entry.name).kind !== 'media') {
				counts.skippedByType++;
				continue;
			}
			if (entry.uncompressedSize > MAX_MEDIA_FILE_BYTES) {
				counts.overCap++;
				continue;
			}
			// shortcut: one copy per row, share the object if duplicates show up in real archives
			const ids = isDetached ? [await detachedId(treeId, entry.name)] : targets;
			const bytes = entry.uncompressedSize * ids.length;
			if (batchBytes > 0 && batchBytes + bytes > MEDIA_BATCH_BYTES) break;
			batchBytes += bytes;

			for (const id of ids) {
				if (stored + entry.uncompressedSize > MAX_TREE_MEDIA_BYTES) {
					counts.overQuota++;
					break;
				}
				const outcome = await this.storeEntry(
					source,
					treeId,
					id,
					entry,
					message.actorId ?? null,
					isDetached
				);
				if (outcome === 'stored') {
					stored += entry.uncompressedSize;
					if (isDetached) counts.detachedAdded++;
					else counts.resolved++;
				} else if (outcome === 'type') {
					counts.skippedByType++;
					break;
				} else {
					counts.unreadable++;
					break;
				}
			}
		}
		return { next: at < entries.length ? at : null, total: entries.length, counts };
	}

	/** Deletes the staged archive and answers how many files of the tree still have no bytes. */
	async close(message: ImportQueueMessage): Promise<number> {
		await this.requireImporter(message);
		await this.bindings.bucket!.delete(message.r2ObjectKey);
		return this.media.countUnresolved(message.treeId);
	}

	private async storeEntry(
		source: ZipSource,
		treeId: string,
		id: string,
		entry: ZipEntry,
		uploadedBy: string | null,
		isDetached: boolean
	): Promise<'stored' | 'type' | 'unreadable'> {
		try {
			const { head, body } = await peek(await openEntry(source, entry));
			const sniffed = sniffMediaType(head);
			const byName = classifyMediaEntry(entry.name);
			// A name claiming an image or PDF must be one: only audio, video and captions have no magic
			// numbers to check, and those are never served inline.
			if (byName.kind !== 'media' || (!sniffed && isUploadMediaType(byName.mime))) {
				await body.cancel();
				return 'type';
			}
			const kind = sniffed ? classifyMediaEntry(entry.name, sniffed) : byName;
			if (kind.kind !== 'media') {
				await body.cancel();
				return 'type';
			}
			const objectKey = `media/${treeId}/${id}.${kind.extension}`;
			await this.bindings.bucket!.put(
				objectKey,
				fixedLengthBody(body, entry.uncompressedSize) as unknown as WorkersReadableStream,
				{
					httpMetadata: { contentType: kind.mime }
				}
			);
			const row = {
				objectKey,
				mimeType: kind.mime,
				sizeBytes: entry.uncompressedSize,
				// Checked against the bytes by the reader, so it is the real CRC when the put succeeded.
				crc32: entry.crc32
			};
			if (isDetached) {
				await this.media.insertDetached(treeId, { id, gedcomPath: entry.name, uploadedBy, ...row });
			} else {
				await this.media.markResolved(id, row);
			}
			return 'stored';
		} catch (err) {
			if (err instanceof ValidationError) return 'unreadable';
			throw err;
		}
	}

	/** The requester must still hold `tree:import`; a refusal throws before anything is read or written. */
	private async requireImporter(message: ImportQueueMessage): Promise<void> {
		if (!message.actorId) throw new UnauthorizedError('Queued import has no actor');
		await requireMemberAction(this.users, message.treeId, message.actorId, 'tree:import');
	}

	private async open(message: ImportQueueMessage) {
		await this.requireImporter(message);
		const bucket: R2Bucket | undefined = this.bindings.bucket;
		if (!bucket) throw new Error('Storage binding unavailable');
		// The key rides in the payload, and this bucket also holds media and exports.
		if (!message.isArchive || !isUploadKeyOf(message.treeId, message.r2ObjectKey)) {
			throw new UnauthorizedError('The import names an object outside its upload area');
		}
		const source = await r2ZipSource(bucket, message.r2ObjectKey);
		const directory = await readCentralDirectory(source);
		const { names } = indexEntryNames(directory.entries.map((e) => e.name));
		return { source, directory, names };
	}
}
