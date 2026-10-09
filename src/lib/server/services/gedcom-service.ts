/**
 * GEDCOM import and export. The routes, the queue consumer and the export workflow all come
 * through here, so authorization (`tree:import`, `tree:export`), the large-file hand-off to the
 * queue and the one way an export is named and stored each live in one place.
 *
 * Authorization reads only the caller's membership, never the tree's rows. The methods that take
 * no context (`runImport`, `loadExport`, `storeExport`) are for a job that was authorized when it
 * was queued; they never face a request.
 */

import type { R2Bucket } from '@cloudflare/workers-types';
import type { DbClient } from '../db';
import { UnauthorizedError, ValidationError } from '../domain/errors';
import type { AuthenticatedContext } from '../domain/identity';
import { foldIntoExistingAliases, mergeExactDuplicateFamilies } from '../gedcom/duplicate-families';
import { exportPayloadFrom } from '../gedcom/export-payload';
import { GEDZIP_CONTENT_TYPE, packGedzip } from '../gedcom/gedzip';
import {
	previewAgainstTree,
	previewNewTree,
	type ImportMode,
	type ImportOptions,
	type ImportPreview
} from '../gedcom/import-preview';
import { parseGedcom } from '../gedcom/parser';
import { buildGedcomString } from '../gedcom/serializer';
import type { GedcomFormat } from '../gedcom/tags';
import { GedcomRepository } from '../repositories/gedcom-repository';
import { UserRepository } from '../repositories/user-repository';
import { TreeService } from './tree-service';
import { requireMemberAction, requireTreeAction } from './tree-access';

/** Above this a file is staged in R2 and imported by the queue consumer, when both are bound. */
const LARGE_IMPORT_BYTES = 2 * 1024 * 1024;

/** What travels through the import queue. A message outlives a deploy, so keep it additive. */
export interface ImportQueueMessage {
	treeId: string;
	r2ObjectKey: string;
	treeName?: string;
	mode?: ImportMode;
	/** Carried through the queue so a large file is merged exactly as the preview promised. */
	shouldMergeDuplicateFamilies?: boolean;
}

/** The storage and queue an import or export may use; a binding that is absent is simply not used. */
export interface GedcomBindings {
	bucket?: R2Bucket;
	queue?: { send(message: ImportQueueMessage): Promise<unknown> };
}

export interface ImportCounts {
	individualsCount: number;
	familiesCount: number;
	eventsCount: number;
	mergedFamiliesCount: number;
}

export interface ImportFile {
	/** The tree to import into; none creates a new tree owned by the caller. */
	treeId: string | null;
	treeName: string | null;
	fileName: string;
	text: string;
	sizeBytes: number;
	mode: ImportMode;
	shouldMergeDuplicateFamilies: boolean;
}

export type ImportOutcome =
	{ status: 'queued'; treeId: string } | ({ status: 'complete'; treeId: string } & ImportCounts);

/** How a tree is exported. */
export interface ExportOptions {
	format: GedcomFormat;
	/** Package the file as a GEDZip (`.gdz`) archive. GEDZip is defined for 7.0 only. */
	shouldCompress?: boolean;
}

export interface ExportFile {
	content: string | Uint8Array<ArrayBuffer>;
	filename: string;
	contentType: string;
}

const GEDCOM_CONTENT_TYPE = 'text/vnd.familysearch.gedcom';

/** GEDZip's version is the dataset's, and 7.0 was its first, so a 5.5.1 file has no archive form. */
function assertExportable({ format, shouldCompress }: ExportOptions): void {
	if (shouldCompress && format !== 'gedcom7') {
		throw new ValidationError('A .gdz archive can only hold a GEDCOM 7.0 file');
	}
}

/**
 * The file an export is downloaded and stored as, named after the tree: reduced to characters that
 * are safe in a header and a file system. The R2 copy once used the tree's id instead; a person who
 * opens either file wants to know which tree it is, so both use the name now.
 */
function exportFile(treeName: string, gedcom: string, shouldCompress = false): ExportFile {
	const base = treeName.replace(/[^a-zA-Z0-9_-]/g, '_');
	return shouldCompress
		? { content: packGedzip(gedcom), filename: `${base}.gdz`, contentType: GEDZIP_CONTENT_TYPE }
		: { content: gedcom, filename: `${base}.ged`, contentType: GEDCOM_CONTENT_TYPE };
}

/** The name an import makes a tree under when none is given: the file's, without its extension. */
function treeNameOf(fileName: string): string {
	return fileName.replace(/\.(ged|gedcom|gdz)$/i, '');
}

export class GedcomService {
	private repo: GedcomRepository;
	private users: UserRepository;

	constructor(
		private db: DbClient,
		private bindings: GedcomBindings = {}
	) {
		this.repo = new GedcomRepository(db);
		this.users = new UserRepository(db);
	}

	/**
	 * Throws unless the caller may export this tree. The export carries every person, living ones
	 * included, so it is a manager's action until exports can be filtered per viewer (ADR-015).
	 */
	async requireExport(treeId: string, context: AuthenticatedContext): Promise<void> {
		await requireTreeAction(this.users, treeId, context, 'tree:export');
	}

	/** The same check for the export workflow, which knows the requester's id and nothing else. */
	async requireExporter(treeId: string, userId: string | undefined): Promise<void> {
		// A job with no requester must not export at all (ADR-015).
		if (!userId)
			throw new UnauthorizedError("Forbidden: insufficient privileges for action 'tree:export'");
		await requireMemberAction(this.users, treeId, userId, 'tree:export');
	}

	/** Throws unless the caller may import into this tree. Reads only the caller's membership, never the tree. */
	async requireImport(treeId: string, context: AuthenticatedContext): Promise<void> {
		await requireTreeAction(this.users, treeId, context, 'tree:import');
	}

	/** Preview for a file with no tree to compare against: a new tree, so only the file is analysed. */
	previewFile(text: string): ImportPreview {
		return previewNewTree(parseGedcom(text));
	}

	/** Preview against a tree. It reads the tree's rows to compare, so it needs the import right. */
	async previewImport(
		treeId: string,
		text: string,
		context: AuthenticatedContext
	): Promise<ImportPreview> {
		await this.requireImport(treeId, context);
		return this.previewTree(treeId, text);
	}

	/** The comparison itself, with no authorization check: see `previewImport`. */
	async previewTree(treeId: string, text: string): Promise<ImportPreview> {
		const fresh = parseGedcom(text);
		if (!(await this.repo.treeExists(treeId))) return previewNewTree(fresh);
		// A family that was merged into another the last time counts as that one, so the counts match what the import will do.
		const parsed = foldIntoExistingAliases(fresh, await this.repo.aliasesInTree(treeId)).parsed;
		return previewAgainstTree(treeId, fresh, parsed, await this.repo.previewRows(treeId));
	}

	/**
	 * Import a file, creating the tree first when none is named. A large file is staged in R2 for
	 * the queue consumer when both are bound, and imported in the request otherwise.
	 */
	async importFile(file: ImportFile, context: AuthenticatedContext): Promise<ImportOutcome> {
		const baseName = treeNameOf(file.fileName);
		let treeId = file.treeId;
		if (treeId) {
			await this.requireImport(treeId, context);
		} else {
			const created = await new TreeService(this.db).createTree(
				file.treeName || baseName || 'Imported Tree',
				null,
				context
			);
			treeId = created.id;
		}

		const { bucket, queue } = this.bindings;
		if (file.sizeBytes > LARGE_IMPORT_BYTES && queue && bucket) {
			const r2ObjectKey = `staging/gedcom-${treeId}-${Date.now()}.ged`;
			await bucket.put(r2ObjectKey, file.text);
			const message: ImportQueueMessage = {
				treeId,
				r2ObjectKey,
				treeName: file.treeName || baseName,
				mode: file.mode,
				shouldMergeDuplicateFamilies: file.shouldMergeDuplicateFamilies
			};
			await queue.send(message);
			return { status: 'queued', treeId };
		}

		const counts = await this.runImport(treeId, file.text, file.treeName || baseName, file.mode, {
			shouldMergeDuplicateFamilies: file.shouldMergeDuplicateFamilies
		});
		return { status: 'complete', treeId, ...counts };
	}

	/**
	 * Write a file into a tree with no authorization check: for the queue consumer, whose request
	 * was authorized when it was made, and for tests that seed a tree.
	 */
	async runImport(
		treeId: string,
		text: string,
		treeName?: string,
		mode: ImportMode = 'replace',
		options: ImportOptions = {}
	): Promise<ImportCounts> {
		const folded = options.shouldMergeDuplicateFamilies
			? mergeExactDuplicateFamilies(parseGedcom(text))
			: { parsed: parseGedcom(text), mergedCount: 0 };
		let parsed = folded.parsed;
		const isExistingTree = await this.repo.treeExists(treeId);
		if (isExistingTree && mode === 'merge') {
			// A family merged into another in an earlier import must not come back under its old XREF.
			parsed = foldIntoExistingAliases(parsed, await this.repo.aliasesInTree(treeId)).parsed;
		}
		const written = await this.repo.writeImport({ treeId, treeName, parsed, mode, isExistingTree });
		return { ...written, mergedFamiliesCount: folded.mergedCount };
	}

	/**
	 * Import a staged file for a queue message, then remove the staging object. Answers false when
	 * the object is gone, so the consumer can drop a message that can never succeed.
	 */
	async importStaged(message: ImportQueueMessage): Promise<boolean> {
		const bucket = this.bindings.bucket;
		if (!bucket) throw new Error('Storage binding unavailable');
		const object = await bucket.get(message.r2ObjectKey);
		if (!object) return false;
		await this.runImport(
			message.treeId,
			await object.text(),
			message.treeName,
			message.mode ?? 'replace',
			{ shouldMergeDuplicateFamilies: message.shouldMergeDuplicateFamilies }
		);
		await bucket.delete(message.r2ObjectKey);
		return true;
	}

	/** The tree as the serializers read it, with no authorization check: see `requireExport`. */
	async loadExport(treeId: string) {
		return exportPayloadFrom(treeId, await this.repo.loadExportRows(treeId));
	}

	/** A tree's GEDCOM file, for a download. */
	async exportDownload(
		treeId: string,
		options: ExportOptions,
		context: AuthenticatedContext
	): Promise<ExportFile> {
		assertExportable(options);
		await this.requireExport(treeId, context);
		const data = await this.loadExport(treeId);
		return exportFile(
			data.treeName,
			buildGedcomString(data, options.format),
			options.shouldCompress
		);
	}

	/**
	 * Put serialized GEDCOM in R2, packaged as GEDZip when asked, and answer its key. The key carries
	 * the tree's id and the time so two exports never collide; the download name is the tree's name.
	 */
	async storeExport(
		treeId: string,
		treeName: string,
		gedcom: string,
		shouldCompress = false
	): Promise<string> {
		const bucket = this.bindings.bucket;
		if (!bucket) throw new Error('Storage binding unavailable');
		const file = exportFile(treeName, gedcom, shouldCompress);
		const key = `exports/${treeId}-${Date.now()}.${shouldCompress ? 'gdz' : 'ged'}`;
		await bucket.put(key, file.content, {
			httpMetadata: {
				contentType: file.contentType,
				contentDisposition: `attachment; filename="${file.filename}"`
			}
		});
		return key;
	}

	/** Export straight to R2 in the request, when no workflow is bound. */
	async exportToStorage(
		treeId: string,
		options: ExportOptions,
		context: AuthenticatedContext
	): Promise<string> {
		assertExportable(options);
		await this.requireExport(treeId, context);
		const data = await this.loadExport(treeId);
		return this.storeExport(
			treeId,
			data.treeName,
			buildGedcomString(data, options.format),
			options.shouldCompress
		);
	}
}
