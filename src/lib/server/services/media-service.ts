/**
 * Who may read or add a media object (Phase 4 items 3 and 10). The key alone is never a credential:
 * a read is checked against the tree, then against the row that owns the object, and a private
 * person's media answers as a missing object. Ownership is the row's `entity_id`, not the key.
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
import { parseMediaKey } from '../media/media-key';
import { listAllObjects, storedBytesByTree, sumStoredBytes } from '../media/stored-bytes';
import {
	MediaRepository,
	type MediaOwnerKind,
	type FileCursor,
	type MediaItemRow,
	type StoredMedia
} from '../repositories/media-repository';
import { TreeRepository } from '../repositories/tree-repository';
import { UserRepository } from '../repositories/user-repository';
import { visibleAmong, visibleSourcesAmong } from '../repositories/visibility';
import { MAX_TREE_MEDIA_BYTES } from '../../shared/media';
import type {
	FileLinkDto,
	FileListDto,
	FileRowDto,
	FileUsageDto,
	UnlinkedFileDto,
	UnlinkedListDto
} from '../../shared/files';
import { hasMinimumRole, type TreeRole } from '../../shared/roles';
import { canSeePrivatePeople, isActionAllowed } from '../auth/authorization';
import { requireRealUser, requireTreeScope, type ViewerScope } from './tree-access';
import { describeCommand } from '../domain/command-summary';
import type { MediaCommand } from '../domain/media-ops';
import { MutationRunner, type MutationResult } from './mutation-runner';

export { parseMediaKey };

/** Where each kind of linked record has its page, under the tree. */
const LINK_ROUTES = { person: 'people', union: 'unions', source: 'sources' } as const;

export interface FileRenameInput {
	treeId: string;
	mediaId: string;
	title: string;
	expectedVersion?: number;
}

export interface FileLinkInput {
	treeId: string;
	mediaId: string;
	/** The person, partnership or source the file is linked to or unlinked from. */
	entityId: string;
	expectedVersion?: number;
}

/**
 * What a file is linked to, for deciding who may read it. A link to a partnership counts as its
 * partners. `isDangling` is a link to a record that is not there, or to a partnership with no
 * partners: nothing to check it against, so it is hidden.
 */
interface FileLinks {
	people: readonly string[];
	sources: readonly string[];
	isDangling: boolean;
}

/** The records the viewer can see among a batch's linked records. */
interface VisibleOwners {
	people: ReadonlySet<string>;
	sources: ReadonlySet<string>;
}

/**
 * Whether a viewer may read a file: every record it is linked to must be visible, a person, every
 * partner of a partnership, a source (ADR-028's rule, held to `maskRows` by a test). A file with no
 * link is editor-only. Kept as one function so every read path shares the rule.
 */
function canReadRow(
	links: FileLinks,
	scope: Pick<ViewerScope, 'isRestricted'>,
	visible: VisibleOwners
): boolean {
	if (!scope.isRestricted) return true;
	if (links.isDangling || (links.people.length === 0 && links.sources.length === 0)) return false;
	return (
		links.people.every((id) => visible.people.has(id)) &&
		links.sources.every((id) => visible.sources.has(id))
	);
}

/** What a batch of files is linked to, resolved to kinds and partners once for the whole batch. */
interface ResolvedLinks {
	kinds: ReadonlyMap<string, MediaOwnerKind>;
	partners: ReadonlyMap<string, string[]>;
	entityIds: string[];
	personIds: Set<string>;
	sourceIds: string[];
	unionIds: string[];
	linksOf: (mediaId: string) => FileLinks;
	entitiesOf: (mediaId: string) => readonly string[];
}

async function resolveLinks(
	media: MediaRepository,
	treeId: string,
	mediaIds: readonly string[]
): Promise<ResolvedLinks> {
	const byMedia = await media.linksOf(treeId, mediaIds);
	const entityIds = [...new Set([...byMedia.values()].flat())];
	const kinds = await media.recordKindsOf(treeId, entityIds);
	const unionIds = entityIds.filter((id) => kinds.get(id) === 'union');
	const sourceIds = entityIds.filter((id) => kinds.get(id) === 'source');
	const partners = await media.partnersOf(unionIds);
	const personIds = new Set(entityIds.filter((id) => kinds.get(id) === 'person'));
	for (const list of partners.values()) for (const id of list) personIds.add(id);
	return {
		kinds,
		partners,
		entityIds,
		personIds,
		sourceIds,
		unionIds,
		entitiesOf: (mediaId) => byMedia.get(mediaId) ?? [],
		linksOf: (mediaId) => {
			const people: string[] = [];
			const sources: string[] = [];
			let isDangling = false;
			for (const id of byMedia.get(mediaId) ?? []) {
				const kind = kinds.get(id);
				if (kind === 'person') people.push(id);
				else if (kind === 'source') sources.push(id);
				else if (kind === 'union') {
					const list = partners.get(id) ?? [];
					if (list.length === 0) isDangling = true;
					people.push(...list);
				} else isDangling = true;
			}
			return { people, sources, isDangling };
		}
	};
}

/** The linked records the viewer can see, for the files in `resolved`; only asked of a restricted viewer. */
async function visibleOf(
	db: DbClient,
	treeId: string,
	resolved: ResolvedLinks,
	scope: ViewerScope
): Promise<VisibleOwners> {
	return {
		people: await visibleAmong(db, treeId, [...resolved.personIds], scope),
		sources: await visibleSourcesAmong(db, treeId, resolved.sourceIds, scope)
	};
}

/**
 * Which of these files the viewer may read, by the one rule in `canReadRow`. The Files list, a
 * direct read and a person's page all go through it, so they cannot disagree.
 */
export async function readableFileIds(
	db: DbClient,
	treeId: string,
	mediaIds: readonly string[],
	scope: ViewerScope
): Promise<Set<string>> {
	if (!scope.isRestricted || mediaIds.length === 0) return new Set(mediaIds);
	const resolved = await resolveLinks(new MediaRepository(db), treeId, mediaIds);
	const visible = await visibleOf(db, treeId, resolved, scope);
	return new Set(mediaIds.filter((id) => canReadRow(resolved.linksOf(id), scope, visible)));
}

/**
 * Whether the viewer may delete a file. A manager may delete any; an editor
 * may delete the files they uploaded. A file with no recorded uploader (every file uploaded before
 * migration 0029) is a manager's to delete.
 */
export function canDeleteMedia(
	scope: Pick<ViewerScope, 'role' | 'userId'>,
	uploadedBy: string | null
): boolean {
	if (isActionAllowed(scope.role, 'media:delete_any')) return true;
	return isActionAllowed(scope.role, 'media:manage') && uploadedBy === scope.userId;
}

/** A tree in the caller's list: its name, and the caller's role there (null when they are not a member). */
interface CallerTree {
	name: string;
	role: TreeRole | null;
}

/** What a tree's files need decided, for one listing batch. */
interface TreeView {
	isRestricted: boolean;
	/** Records in the tree the caller may see; only consulted when `isRestricted`. */
	visible: VisibleOwners;
	resolved: ResolvedLinks;
	/** Names shown beside a file, keyed by the record it is linked to. */
	labels: ReadonlyMap<string, string>;
}

export interface FileQuery {
	treeId?: string;
	/** Only files linked to this person, partnership or source. */
	entityId?: string;
	/** Only files linked to nothing. */
	isDetachedOnly?: boolean;
	cursor?: string;
	limit?: number;
}

/**
 * How old an object must be before it counts as unlinked. An upload writes its bytes before its row,
 * so a young object with no row may simply be an upload still in progress.
 */
const UNLINKED_GRACE_MS = 60 * 60 * 1000;

/** R2 takes at most this many keys in one delete call. */
const DELETES_PER_CALL = 1000;

/** Files per page, and the most a caller may ask for. */
const FILE_PAGE_SIZE = 50;
const FILE_PAGE_MAX = 100;
/** Rows read per database query while scanning for a page. */
const FILE_SCAN_BATCH = 100;
/**
 * Rows read per listing request, whatever the viewer may see. A restricted viewer's page can be
 * short or empty when most of the tree is hidden; this bounds the work that takes. Not yet indexed:
 * the scan is a sort of the whole table, which is acceptable at this size.
 */
const FILE_SCAN_CAP = 500;

const isManagerRole = (role: TreeRole | null | undefined): boolean =>
	role !== null && role !== undefined && hasMinimumRole(role, 'manager');

/** The cursor's sort key: the stored timestamp, which is whole seconds. */
function createdKeyOf(row: MediaItemRow): number {
	return row.createdAt ? Math.floor(row.createdAt.getTime() / 1000) : 0;
}

function formatFileCursor(cursor: FileCursor): string {
	return `${cursor.createdAt}:${cursor.id}`;
}

/** Throws on anything but a cursor this service issued, so a made-up one is refused, not guessed at. */
function parseFileCursor(raw: string): FileCursor {
	const match = /^(\d+):([A-Za-z0-9-]+)$/.exec(raw);
	if (!match) throw new ValidationError('The file listing cursor is not valid');
	return { createdAt: Number(match[1]), id: match[2]! };
}

/** What the caller may do with one file. A file in a tree the caller is not a member of allows nothing. */
function rightsOf(row: MediaItemRow, role: TreeRole | null, userId: string) {
	if (role === null) {
		return {
			canPreview: false,
			canRename: false,
			canLink: false,
			canDelete: false
		};
	}
	const canEdit = isActionAllowed(role, 'media:manage');
	return {
		canPreview: true,
		canRename: canEdit,
		canLink: canEdit,
		canDelete: canDeleteMedia({ role, userId }, row.uploadedBy)
	};
}

function fileDto(
	row: MediaItemRow,
	tree: CallerTree,
	links: FileLinkDto[],
	uploadedBy: string | null,
	userId: string
): FileRowDto {
	const rights = rightsOf(row, tree.role, userId);
	return {
		id: row.id,
		title: row.title,
		version: row.version,
		mimeType: row.mimeType,
		sizeBytes: row.sizeBytes,
		treeId: row.treeId,
		treeName: tree.name,
		links,
		uploadedBy,
		createdAt: row.createdAt ? row.createdAt.getTime() : null,
		// The object key is what the serve route reads by, so it goes only to a caller who may preview.
		previewKey: rights.canPreview ? row.r2ObjectKey : null,
		...rights
	};
}

export class MediaService {
	private media: MediaRepository;
	private users: UserRepository;
	private trees: TreeRepository;

	private runner: MutationRunner;

	constructor(
		private db: DbClient,
		private now: () => Date = () => new Date()
	) {
		this.media = new MediaRepository(db);
		this.users = new UserRepository(db);
		this.trees = new TreeRepository(db);
		this.runner = new MutationRunner(db, {
			now: () => now().getTime(),
			newId: () => crypto.randomUUID()
		});
	}

	/**
	 * Throws unless the caller may read this object; returns the row's title so the serve route can
	 * name the download without a second query. A key that is not ours, or whose row they cannot
	 * see, is a missing object. The tree is checked before the row is read, so a caller outside the
	 * tree is refused without learning whether a key exists in it.
	 */
	async requireRead(key: string, context: AuthenticatedContext): Promise<{ title: string | null }> {
		const parsed = parseMediaKey(key);
		if (!parsed) throw new NotFoundError('Media', key);
		const scope = await requireTreeScope(
			this.users,
			this.trees,
			parsed.treeId,
			context,
			'media:view',
			this.now()
		);
		const row = await this.media.findByKey(parsed.treeId, key);
		if (!row) throw new NotFoundError('Media', key);
		if (!(await readableFileIds(this.db, parsed.treeId, [row.id], scope)).has(row.id))
			throw new NotFoundError('Media', key);
		return { title: row.title };
	}

	/** Throws unless the caller may add media to this record of this tree. */
	async requireUpload(
		treeId: string,
		entityId: string,
		context: AuthenticatedContext
	): Promise<void> {
		await requireTreeScope(this.users, this.trees, treeId, context, 'media:manage', this.now());
		if (!(await this.media.ownerOf(treeId, entityId)))
			throw new ValidationError('The record to attach media to is not in this tree');
	}

	/**
	 * Throws when storing `incomingBytes` more would take the tree past `MAX_TREE_MEDIA_BYTES`. Runs
	 * before the bytes are written. The total is read and then the write follows, so two uploads
	 * racing at the edge can both pass; the quota is soft and that overshoot is accepted.
	 * shortcut: lists R2 on every upload (one call per 1,000 objects) and is not atomic; move to a
	 * running per-tree byte counter in D1 once a tree holds thousands of files. Call only
	 * after `requireUpload`, so a caller who may not add media never learns how full the tree is.
	 */
	async requireQuotaFor(treeId: string, incomingBytes: number, bucket: R2Bucket): Promise<void> {
		const storedBytes = await sumStoredBytes(bucket, `media/${treeId}/`);
		if (storedBytes + incomingBytes > MAX_TREE_MEDIA_BYTES)
			throw new PayloadTooLargeError(
				'This tree has no room for this file: its media storage is full'
			);
	}

	/**
	 * The trees the caller stands in, with their names and the caller's role in each. The install
	 * owner also appears in trees they are not a member of, with no role: they may see a file's
	 * metadata there but nothing that would reveal the people in it.
	 */
	private async callerTrees(context: AuthenticatedContext): Promise<Map<string, CallerTree>> {
		const userId = context.user.id;
		if (context.user.isInstallOwner === true) {
			const all = await this.trees.listAll(userId);
			return new Map(all.map((t) => [t.id, { name: t.name, role: t.role ?? null }]));
		}
		const mine = await this.trees.listForUser(userId);
		return new Map(mine.map((t) => [t.id, { name: t.name, role: t.role ?? null }]));
	}

	/**
	 * Whether each file may be seen, and what the caller may do with it, for one batch of rows. The
	 * visibility answer comes from the same `canReadRow` `requireRead` uses, fed by the same owner
	 * lookup (a detached file, people, partnerships, a partnership with no partners), so the list
	 * and a direct read cannot disagree. Lookups are batched per tree, so a batch costs a handful of
	 * queries however many files it holds.
	 */
	private async decideRows(
		rows: MediaItemRow[],
		trees: Map<string, CallerTree>,
		context: AuthenticatedContext
	): Promise<Array<FileRowDto | null>> {
		const views = new Map<string, TreeView>();
		for (const treeId of new Set(rows.map((row) => row.treeId))) {
			const access = trees.get(treeId);
			if (!access || access.role === null) continue;
			views.set(treeId, await this.viewOf(treeId, access.role, rows, context));
		}
		const uploaderIds = rows
			.filter((row) => row.uploadedBy !== null && isManagerRole(trees.get(row.treeId)?.role))
			.map((row) => row.uploadedBy as string);
		const uploaders = await this.media.uploaderNamesOf(uploaderIds);
		return rows.map((row) => {
			const tree = trees.get(row.treeId);
			if (!tree) return null;
			// A tree the caller is not a member of (install owner only): metadata, nothing that names a person.
			if (tree.role === null) return fileDto(row, tree, [], null, context.user.id);
			const view = views.get(row.treeId);
			if (!view || !canReadRow(view.resolved.linksOf(row.id), view, view.visible)) return null;
			const links = view.resolved.entitiesOf(row.id).flatMap((entityId): FileLinkDto[] => {
				const kind = view.resolved.kinds.get(entityId);
				if (!kind) return [];
				return [
					{
						entityId,
						kind,
						label: view.labels.get(entityId) ?? '',
						href: `/trees/${row.treeId}/${LINK_ROUTES[kind]}/${entityId}`
					}
				];
			});
			const uploadedBy =
				row.uploadedBy !== null && isManagerRole(tree.role)
					? (uploaders.get(row.uploadedBy) ?? null)
					: null;
			return fileDto(row, tree, links, uploadedBy, context.user.id);
		});
	}

	/**
	 * What one tree's rows need to be decided: what each file is linked to, which of the people
	 * involved the caller may see, and the names to show. Restricted viewers get a visibility check;
	 * everyone else sees every person, so only names are needed.
	 */
	private async viewOf(
		treeId: string,
		role: TreeRole,
		rows: MediaItemRow[],
		context: AuthenticatedContext
	): Promise<TreeView> {
		const resolved = await resolveLinks(
			this.media,
			treeId,
			rows.filter((r) => r.treeId === treeId).map((r) => r.id)
		);
		const isRestricted = !canSeePrivatePeople(role);
		const scope = isRestricted
			? await requireTreeScope(this.users, this.trees, treeId, context, 'media:view', this.now())
			: null;
		const visible: VisibleOwners = scope
			? await visibleOf(this.db, treeId, resolved, scope)
			: { people: new Set<string>(), sources: new Set<string>() };
		const sourceTitles = await this.media.sourceTitlesOf(treeId, resolved.sourceIds);
		const names = await this.media.personNamesOf(treeId, [...resolved.personIds]);
		const labels = new Map<string, string>();
		for (const id of resolved.entityIds) {
			const kind = resolved.kinds.get(id);
			if (kind === 'person') labels.set(id, names.get(id) ?? 'Unknown');
			if (kind === 'source') labels.set(id, sourceTitles.get(id) ?? 'A source');
			if (kind === 'union') {
				const partnerNames = (resolved.partners.get(id) ?? []).map(
					(p) => names.get(p) ?? 'Unknown'
				);
				labels.set(id, partnerNames.length > 0 ? partnerNames.join(' and ') : 'A partnership');
			}
		}
		return { isRestricted, visible, labels, resolved };
	}

	/**
	 * One page of the files the caller may see, newest first. Rows are read in batches and each
	 * scanned row counts toward a cap, so a restricted viewer whose files are mostly hidden gets a
	 * short page with a cursor rather than a long wait. The cursor is the last row scanned, not the
	 * last row returned, so the next page starts where the scan isStopped.
	 */
	async list(context: AuthenticatedContext, query: FileQuery): Promise<FileListDto> {
		requireRealUser(context);
		const trees = await this.callerTrees(context);
		if (query.treeId !== undefined && !trees.has(query.treeId))
			return { files: [], nextCursor: null };
		const limit = Math.min(query.limit ?? FILE_PAGE_SIZE, FILE_PAGE_MAX);
		let after = query.cursor === undefined ? undefined : parseFileCursor(query.cursor);
		const files: FileRowDto[] = [];
		let last: FileCursor | null = null;
		let scanned = 0;
		let isStopped = false;
		for (;;) {
			if (files.length >= limit || scanned >= FILE_SCAN_CAP) {
				isStopped = true;
				break;
			}
			const batch = await this.media.listNewestFirst({
				treeId: query.treeId,
				entityId: query.entityId,
				isDetachedOnly: query.isDetachedOnly,
				after,
				limit: FILE_SCAN_BATCH
			});
			if (batch.length === 0) break;
			const decided = await this.decideRows(batch, trees, context);
			let isConsumed = true;
			for (const [index, row] of batch.entries()) {
				if (files.length >= limit || scanned >= FILE_SCAN_CAP) {
					isConsumed = false;
					break;
				}
				scanned++;
				last = { createdAt: createdKeyOf(row), id: row.id };
				const file = decided[index];
				if (file) files.push(file);
			}
			if (!isConsumed) {
				isStopped = true;
				break;
			}
			if (batch.length < FILE_SCAN_BATCH) break;
			after = last ?? undefined;
		}
		return {
			files,
			nextCursor: isStopped && last ? formatFileCursor(last) : null
		};
	}

	/**
	 * Storage the caller may see. Per-tree totals go to editors and above of each tree; the install
	 * total goes to the install owner alone. Both come from one listing of R2, because the quota
	 * refusal reads R2 too: a figure from D1 would disagree with it for rows that predate sizes.
	 */
	async usage(
		context: AuthenticatedContext,
		bucket: R2Bucket,
		treeId?: string
	): Promise<FileUsageDto> {
		requireRealUser(context);
		const trees = await this.callerTrees(context);
		const { total, byTree } = await storedBytesByTree(bucket);
		const manageable = [...trees]
			.filter(([, access]) => access.role !== null && isActionAllowed(access.role, 'media:manage'))
			.filter(([id]) => treeId === undefined || id === treeId)
			.map(([id, access]) => ({
				treeId: id,
				treeName: access.name,
				storedBytes: byTree.get(id) ?? 0,
				limitBytes: MAX_TREE_MEDIA_BYTES
			}))
			.sort((a, b) => a.treeName.localeCompare(b.treeName));
		return {
			trees: manageable,
			installBytes: context.user.isInstallOwner === true ? total : null
		};
	}

	/**
	 * Rename a file. Logged and undoable like any record change (it is a row update), and refused
	 * unless the caller may manage media in this tree. Editors and above rename any file.
	 */
	rename(context: AuthenticatedContext, input: FileRenameInput): Promise<MutationResult> {
		return this.editFile(input.treeId, context, {
			kind: 'rename_media',
			mediaId: input.mediaId,
			title: input.title,
			expectedVersion: input.expectedVersion
		});
	}

	/** Link a file to a person, partnership or source in the same tree; linking again changes nothing. */
	link(context: AuthenticatedContext, input: FileLinkInput): Promise<MutationResult> {
		return this.editFile(input.treeId, context, {
			kind: 'link_media',
			mediaId: input.mediaId,
			entityId: input.entityId,
			expectedVersion: input.expectedVersion
		});
	}

	/** Unlink a file from one record; the file is kept, and is detached when this was its last link. */
	unlink(context: AuthenticatedContext, input: FileLinkInput): Promise<MutationResult> {
		return this.editFile(input.treeId, context, {
			kind: 'unlink_media',
			mediaId: input.mediaId,
			entityId: input.entityId,
			expectedVersion: input.expectedVersion
		});
	}

	/**
	 * The one path a file edit takes: the tree is checked before any row is read, so a caller outside
	 * it learns nothing about its files, then the change is planned, authorised and logged together.
	 */
	private async editFile(
		treeId: string,
		context: AuthenticatedContext,
		command: MediaCommand
	): Promise<MutationResult> {
		requireRealUser(context);
		await requireTreeScope(this.users, this.trees, treeId, context, 'media:manage', this.now());
		return this.runner.run(treeId, context, {
			kind: command.kind,
			summary: (rows) => describeCommand(command, rows),
			commands: [command],
			requiredAction: () => 'media:manage'
		});
	}

	/**
	 * Delete a file: its row first, then its bytes. Not a logged change, so it cannot be undone; an
	 * earlier change that involves the file will refuse its undo once it is gone. A manager may delete
	 * any file, and an editor only their own uploads. The bytes are removed after the row, so if that
	 * second step fails the file is still gone for everyone and the bytes become an orphan that the
	 * unlinked cleanup finds; `wasObjectRemoved` says which happened.
	 */
	async delete(
		context: AuthenticatedContext,
		input: { treeId: string; mediaId: string },
		bucket: R2Bucket
	): Promise<{ wasObjectRemoved: boolean }> {
		requireRealUser(context);
		const scope = await requireTreeScope(
			this.users,
			this.trees,
			input.treeId,
			context,
			'media:manage',
			this.now()
		);
		const file = await this.media.findById(input.mediaId);
		if (!file || file.treeId !== input.treeId) throw new NotFoundError('File', input.mediaId);
		if (!canDeleteMedia(scope, file.uploadedBy))
			throw new UnauthorizedError(
				"Forbidden: insufficient privileges for action 'media:delete_any'"
			);
		await this.media.deleteRow(file.id);
		try {
			await bucket.delete(file.r2ObjectKey);
			return { wasObjectRemoved: true };
		} catch {
			return { wasObjectRemoved: false };
		}
	}

	/**
	 * Objects in storage that no file row points at, in the trees the caller may clean up (managers
	 * and owners). One listing of R2 is compared with the keys each tree's rows name. An object
	 * younger than the grace period, or whose upload time is unknown, is left alone.
	 */
	async listUnlinked(
		context: AuthenticatedContext,
		bucket: R2Bucket,
		treeId?: string
	): Promise<UnlinkedListDto> {
		const files = await this.findUnlinked(context, bucket, treeId);
		return { files, totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0) };
	}

	/**
	 * Deletes the unlinked objects found by a fresh listing, never a list the client sent. Returns how
	 * many were deleted and how many the bucket refused.
	 */
	async deleteUnlinked(
		context: AuthenticatedContext,
		bucket: R2Bucket,
		treeId?: string
	): Promise<{ deleted: number; failed: number }> {
		const files = await this.findUnlinked(context, bucket, treeId);
		let deleted = 0;
		let failed = 0;
		for (let start = 0; start < files.length; start += DELETES_PER_CALL) {
			const keys = files.slice(start, start + DELETES_PER_CALL).map((file) => file.key);
			try {
				await bucket.delete(keys);
				deleted += keys.length;
			} catch {
				failed += keys.length;
			}
		}
		return { deleted, failed };
	}

	private async findUnlinked(
		context: AuthenticatedContext,
		bucket: R2Bucket,
		treeId?: string
	): Promise<UnlinkedFileDto[]> {
		requireRealUser(context);
		const trees = await this.callerTrees(context);
		const manageable = new Map(
			[...trees].filter(
				([id, access]) =>
					(treeId === undefined || id === treeId) &&
					access.role !== null &&
					isActionAllowed(access.role, 'media:delete_any')
			)
		);
		if (manageable.size === 0) return [];
		const cutoff = this.now().getTime() - UNLINKED_GRACE_MS;
		const candidates = (await listAllObjects(bucket, 'media/')).flatMap((object) => {
			const owningTree = parseMediaKey(object.key)?.treeId;
			if (owningTree === undefined || !manageable.has(owningTree)) return [];
			if (object.uploaded === undefined || object.uploaded.getTime() > cutoff) return [];
			return [
				{ key: object.key, treeId: owningTree, size: object.size, uploaded: object.uploaded }
			];
		});
		const linked = new Map<string, Set<string>>();
		for (const owningTree of new Set(candidates.map((c) => c.treeId))) {
			linked.set(owningTree, await this.media.keysInTree(owningTree));
		}
		return candidates
			.filter((c) => !linked.get(c.treeId)?.has(c.key))
			.map((c) => ({
				key: c.key,
				treeId: c.treeId,
				treeName: trees.get(c.treeId)?.name ?? '',
				sizeBytes: c.size,
				uploadedAt: c.uploaded.getTime()
			}));
	}

	record(treeId: string, entityId: string, media: StoredMedia): Promise<void> {
		return this.media.insert(treeId, entityId, media);
	}
}
