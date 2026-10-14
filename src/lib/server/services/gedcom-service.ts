/**
 * GEDCOM import and export. The routes, the queue consumer and the export workflow all come
 * through here, so authorization (`tree:import`, `tree:export`), the large-file hand-off to the
 * queue and the one way an export is named and stored each live in one place.
 *
 * Authorization reads only the caller's membership, never the tree's rows. The methods that take
 * no context (`runImport`, `loadExport`, `storeExport`) never face a request: a queued import is
 * re-authorized against its actor in `importStaged` before `runImport` is reached.
 */

import type { R2Bucket } from '@cloudflare/workers-types';
import type { DbClient } from '../db';
import {
	NotFoundError,
	PayloadTooLargeError,
	UnauthorizedError,
	ValidationError
} from '../domain/errors';
import type { AuthenticatedContext } from '../domain/identity';
import { isActionAllowed } from '../auth/authorization';
import { foldIntoExistingAliases, mergeExactDuplicateFamilies } from '../gedcom/duplicate-families';
import { exportPayloadFrom } from '../gedcom/export-payload';
import { GEDZIP_CONTENT_TYPE, packGedzip } from '../gedcom/gedzip';
import {
	MAX_DATASET_BYTES,
	MAX_STAGED_BYTES,
	MAX_STAGED_BYTES_PER_TREE,
	STAGED_IMPORT_MAX_AGE_MS
} from '../gedcom/limits';
import { sumStoredBytes } from '../media/stored-bytes';
import {
	previewAgainstTree,
	previewNewTree,
	type ImportMode,
	type ImportOptions,
	type ImportPreview
} from '../gedcom/import-preview';
import { parseGedcom, type ParsedGedcomData } from '../gedcom/parser';
import { buildGedcomString } from '../gedcom/serializer';
import type { GedcomFormat } from '../gedcom/tags';
import { GedcomRepository } from '../repositories/gedcom-repository';
import { UserRepository } from '../repositories/user-repository';
import {
	parseExportInstanceId,
	exportObjectKey,
	type ExportFormatToken,
	type ParsedExportInstance
} from '../workflows/export-instance';
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
	/**
	 * True when the caller named the new tree. A message from before this field existed carries no
	 * value, which is read as explicit so an already-queued import never renames its tree.
	 */
	isTreeNameExplicit?: boolean;
	/** The name the tree was created with, so the file's own name can replace it. */
	createdTreeName?: string;
	/**
	 * The name the uploaded filename yields, or absent when it yields none. The rename candidate
	 * between the embedded `Tree:` name and `HEAD.FILE`.
	 */
	createdTreeFileName?: string;
	/** That tree's row version, so the rename lands only while nothing else changed it. */
	createdTreeVersion?: number;
	/** Who imported, for the change log. */
	actorId?: string;
}

/** Options for `runImport`: the merge switch, plus how to name a tree this import created. */
export interface RunImportOptions extends ImportOptions {
	/**
	 * The name a tree this import created has. When set and the name was not explicit, the file's
	 * own embedded name replaces it after the import.
	 */
	createdTreeName?: string;
	/**
	 * The name the uploaded filename yields, or absent when it yields none. The rename candidate
	 * between the embedded `Tree:` name and `HEAD.FILE`.
	 */
	createdTreeFileName?: string;
	/** That tree's row version, so the rename only lands while nothing else changed it. */
	createdTreeVersion?: number;
	/** True when the caller named the new tree; absent is read as explicit, so nothing renames. */
	isTreeNameExplicit?: boolean;
	/** Who imported, for the change log. */
	actorId?: string;
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
export function assertExportable({ format, shouldCompress }: ExportOptions): void {
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

/** Where `importFile` stages a tree's queued uploads. */
const stagingPrefix = (treeId: string) => `staging/gedcom-${treeId}-`;

/** True for a key shaped like the ones `importFile` writes for this tree, and nothing else. */
const isStagingKeyOf = (treeId: string, key: string) =>
	key.startsWith(stagingPrefix(treeId)) &&
	key.endsWith('.ged') &&
	!key.includes('/', 'staging/'.length);

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

	/**
	 * Authorise a caller to read an export's status or download, before anything is read from the
	 * workflow or R2. The instance id is the only thing the client holds, so it is parsed first: an
	 * id this application never minted, and a tree the caller is not in, answer the same 404, and no
	 * id is echoed. A member who lacks `tree:export` gets an honest 403 — they know the tree exists.
	 * This method touches only the caller's membership; it never calls the workflow or R2.
	 */
	async requireExportInstance(
		instanceId: string,
		context: AuthenticatedContext
	): Promise<ParsedExportInstance> {
		const parsed = parseExportInstanceId(instanceId);
		if (!parsed) throw new NotFoundError('Export');
		const membership = await this.users.getMembership(parsed.treeId, context.user.id);
		if (!membership) throw new NotFoundError('Export');
		if (!isActionAllowed(membership.role, 'tree:export')) {
			throw new UnauthorizedError("Forbidden: insufficient privileges for action 'tree:export'");
		}
		return parsed;
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
		// Before any tree is created: an over-large dataset must not leave an empty tree behind.
		if (file.text.length > MAX_DATASET_BYTES) {
			throw new PayloadTooLargeError(`The dataset exceeds the ${MAX_DATASET_BYTES} byte limit`);
		}
		const baseName = treeNameOf(file.fileName);
		let treeId = file.treeId;
		let createdTreeName: string | undefined;
		let createdTreeVersion: number | undefined;
		if (treeId) {
			await this.requireImport(treeId, context);
		} else {
			const created = await new TreeService(this.db).createTree(
				file.treeName || baseName || 'Imported Tree',
				null,
				context
			);
			treeId = created.id;
			createdTreeName = created.name;
			createdTreeVersion = created.version;
		}
		const isNewTree = file.treeId === null;
		const nameOptions = isNewTree
			? {
					isTreeNameExplicit: file.treeName !== null,
					createdTreeName,
					createdTreeFileName: baseName.trim() || undefined,
					createdTreeVersion,
					actorId: context.user.id
				}
			: {};

		const { bucket, queue } = this.bindings;
		if (file.sizeBytes > LARGE_IMPORT_BYTES && queue && bucket) {
			// Counts what this tree already has queued, not the new file's exact UTF-8 size: the
			// dataset length is at most MAX_DATASET_BYTES, so a fresh tree can never trip the cap
			// after `createTree` has run. The read and the put are not atomic, so two imports racing
			// at the edge can both pass; the cap is a backlog bound, not a hard guarantee.
			const stagedBytes = await sumStoredBytes(
				bucket,
				stagingPrefix(treeId),
				({ key, uploaded }) =>
					isStagingKeyOf(treeId, key) &&
					(uploaded === undefined || Date.now() - uploaded.getTime() < STAGED_IMPORT_MAX_AGE_MS)
			);
			if (stagedBytes + file.text.length > MAX_STAGED_BYTES_PER_TREE) {
				throw new PayloadTooLargeError(
					'This tree already has imports queued. Wait for them to finish, then try again.'
				);
			}
			const r2ObjectKey = `${stagingPrefix(treeId)}${Date.now()}-${crypto.randomUUID()}.ged`;
			await bucket.put(r2ObjectKey, file.text);
			const message: ImportQueueMessage = {
				treeId,
				r2ObjectKey,
				treeName: file.treeName || baseName,
				mode: file.mode,
				shouldMergeDuplicateFamilies: file.shouldMergeDuplicateFamilies,
				actorId: context.user.id,
				...nameOptions
			};
			await queue.send(message);
			return { status: 'queued', treeId };
		}

		const counts = await this.runImport(treeId, file.text, file.treeName ?? undefined, file.mode, {
			shouldMergeDuplicateFamilies: file.shouldMergeDuplicateFamilies,
			...nameOptions
		});
		return { status: 'complete', treeId, ...counts };
	}

	/**
	 * Write a file into a tree without checking who asked. Callers must have authorized the actor
	 * first: `importFile` does so on the request, `importStaged` does so at consume time, because
	 * the request that queued a large import may be long over. Tests also use it to seed a tree.
	 */
	async runImport(
		treeId: string,
		text: string,
		treeName?: string,
		mode: ImportMode = 'replace',
		options: RunImportOptions = {}
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
		await this.renameCreatedTree(treeId, parsed, options);
		return { ...written, mergedFamiliesCount: folded.mergedCount };
	}

	/**
	 * Rename a tree this import created, from the file's own name, but only when the caller did not
	 * name it. Precedence is the embedded `Tree:` name, then the uploaded filename, then `HEAD.FILE`;
	 * a target equal to the name the tree was created with is skipped. The filename is a candidate
	 * only while it yields a non-empty name, so a file whose name is only an extension still lets
	 * `HEAD.FILE` through. A message or call with no `isTreeNameExplicit` is read as explicit, so an
	 * import queued before this change keeps the name it was created with.
	 */
	private async renameCreatedTree(
		treeId: string,
		parsed: ParsedGedcomData,
		options: RunImportOptions
	): Promise<void> {
		const isExplicit = options.isTreeNameExplicit ?? true;
		if (
			isExplicit ||
			options.createdTreeName === undefined ||
			options.createdTreeVersion === undefined
		)
			return;
		if (!options.actorId) return;
		const resolved = parsed.treeName || options.createdTreeFileName || parsed.fileTreeName;
		if (!resolved || resolved === options.createdTreeName) return;
		await this.repo.renameImportedTree(
			treeId,
			options.createdTreeName,
			options.createdTreeVersion,
			resolved,
			options.actorId
		);
	}

	/**
	 * Import a staged file for a queue message, then remove the staging object. Answers false when
	 * the object is gone, so the consumer can drop a message that can never succeed. Throws
	 * `UnauthorizedError` before reading or writing anything when the message's actor no longer
	 * holds `tree:import` on the tree, since access may have been revoked after the message was sent.
	 */
	async importStaged(message: ImportQueueMessage): Promise<boolean> {
		const bucket = this.bindings.bucket;
		if (!bucket) throw new Error('Storage binding unavailable');
		// The key comes from the message, and this bucket also holds media and exports: refuse anything
		// but this tree's own staging file before it can be read or, below, deleted.
		if (!isStagingKeyOf(message.treeId, message.r2ObjectKey)) {
			throw new UnauthorizedError('Queued import names an object outside its staging area', {
				treeId: message.treeId
			});
		}
		try {
			await this.requireQueuedImport(message);
		} catch (err) {
			// The consumer drops a refused message, and nothing else would ever remove the file: a
			// revoked user's upload must not stay in the bucket.
			if (err instanceof UnauthorizedError || err instanceof NotFoundError) {
				await bucket.delete(message.r2ObjectKey);
			}
			throw err;
		}
		const object = await bucket.get(message.r2ObjectKey);
		if (!object) return false;
		// The queue message is not trusted to carry a sane payload: the staged object is read whole, so
		// its size is checked before `text()` buffers it.
		if (object.size > MAX_STAGED_BYTES) {
			// Dropped by the consumer as a message that can never succeed, so nothing would reuse it.
			await bucket.delete(message.r2ObjectKey);
			throw new PayloadTooLargeError(`Staged dataset exceeds the ${MAX_STAGED_BYTES} byte limit`);
		}
		await this.runImport(
			message.treeId,
			await object.text(),
			message.treeName,
			message.mode ?? 'replace',
			{
				shouldMergeDuplicateFamilies: message.shouldMergeDuplicateFamilies,
				createdTreeName: message.createdTreeName,
				createdTreeFileName: message.createdTreeFileName,
				createdTreeVersion: message.createdTreeVersion,
				isTreeNameExplicit: message.isTreeNameExplicit,
				actorId: message.actorId
			}
		);
		await bucket.delete(message.r2ObjectKey);
		return true;
	}

	/**
	 * A queued import runs with the rights its actor holds now. A message with no actor is refused
	 * rather than trusted: nothing else says who asked.
	 */
	private async requireQueuedImport(message: ImportQueueMessage): Promise<void> {
		if (!message.actorId) {
			throw new UnauthorizedError('Queued import has no actor', { treeId: message.treeId });
		}
		await requireMemberAction(this.users, message.treeId, message.actorId, 'tree:import');
	}

	/** The tree as the serializers read it, with no authorization check: see `requireExport`. */
	async loadExport(treeId: string) {
		return exportPayloadFrom(treeId, await this.repo.loadExportRows(treeId));
	}

	/**
	 * How many people the tree holds, for deciding a synchronous export from a queued one and for
	 * enforcing the synchronous ceiling. Reads a count, never a person, so it needs no viewer scope;
	 * the caller has already passed `requireExport`.
	 */
	async countIndividuals(treeId: string): Promise<number> {
		return this.repo.countIndividuals(treeId);
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
	 * Put serialized GEDCOM in R2, packaged as GEDZip when the token says so, and answer its key.
	 * The key comes from the instance's own parts, so a retried step writes the same object rather
	 * than a second one, and a later download can derive it from the instance id alone. The upload
	 * time is recorded as custom metadata: R2's `uploaded` is when the runtime saw the object, which
	 * a copy or a re-upload would reset, whereas the read-time expiry must measure from this write.
	 */
	async storeExport(
		treeId: string,
		treeName: string,
		gedcom: string,
		token: ExportFormatToken,
		clientUuid: string
	): Promise<string> {
		const bucket = this.bindings.bucket;
		if (!bucket) throw new Error('Storage binding unavailable');
		const file = exportFile(treeName, gedcom, token === 'g7z');
		const key = exportObjectKey(treeId, token, clientUuid);
		await bucket.put(key, file.content, {
			httpMetadata: {
				contentType: file.contentType,
				contentDisposition: `attachment; filename="${file.filename}"`
			},
			customMetadata: { uploadedAt: new Date().toISOString() }
		});
		return key;
	}
}
