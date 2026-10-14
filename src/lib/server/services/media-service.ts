/**
 * Who may read or add a media object (Phase 4 items 3 and 10). The key alone is never a credential:
 * a read is checked against the tree, then against the row that owns the object, and a private
 * person's media answers as a missing object. Ownership is the row's `entity_id`, not the key.
 */

import type { R2Bucket } from '@cloudflare/workers-types';
import type { DbClient } from '../db';
import { NotFoundError, PayloadTooLargeError, ValidationError } from '../domain/errors';
import type { AuthenticatedContext } from '../domain/identity';
import { parseMediaKey } from '../media/media-key';
import { sumStoredBytes, storedBytesByTree } from '../media/stored-bytes';
import {
	MediaRepository,
	type FileCursor,
	type MediaItemRow,
	type StoredMedia
} from '../repositories/media-repository';
import { TreeRepository } from '../repositories/tree-repository';
import { UserRepository } from '../repositories/user-repository';
import { visibleAmong } from '../repositories/visibility';
import { MAX_TREE_MEDIA_BYTES } from '../../shared/media';
import type { FileListDto, FileRowDto, FileUsageDto } from '../../shared/files';
import { hasMinimumRole, type TreeRole } from '../../shared/roles';
import { canSeePrivatePeople, isActionAllowed } from '../auth/authorization';
import { requireRealUser, requireTreeScope, type ViewerScope } from './tree-access';
import { describeCommand } from '../domain/command-summary';
import type { MediaCommand } from '../domain/media-ops';
import { MutationRunner, type MutationResult } from './mutation-runner';

export { parseMediaKey };

export interface FileRenameInput {
	treeId: string;
	mediaId: string;
	title: string;
	expectedVersion?: number;
}

export interface FileAttachInput {
	treeId: string;
	mediaId: string;
	/** The person or partnership the file is attached to. */
	entityId: string;
	expectedVersion?: number;
}

export interface FileDetachInput {
	treeId: string;
	mediaId: string;
	expectedVersion?: number;
}

/**
 * Whether a viewer may read a file. `owners` is the people it hangs off: null for a detached file,
 * empty when the owner no longer exists, else the person (or a union's partners). `visible` is the
 * subset of those people the viewer can see. Kept as one function so every read path shares the rule.
 */
function canReadRow(
	owners: readonly string[] | null,
	scope: Pick<ViewerScope, 'isRestricted'>,
	visible: ReadonlySet<string>
): boolean {
	if (!scope.isRestricted) return true;
	if (owners === null) return false;
	return owners.length > 0 && owners.every((id) => visible.has(id));
}

/**
 * Whether the viewer may delete a file attached to a person. A manager may delete any; an editor
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
	/** People in the tree the caller may see; only consulted when `isRestricted`. */
	visible: ReadonlySet<string>;
	/** The people a file hangs off, or null for a detached file. */
	ownersOf: (row: MediaItemRow) => string[] | null;
	/** Names shown beside a file, keyed by the record it is attached to. */
	labels: ReadonlyMap<string, string>;
}

export interface FileQuery {
	treeId?: string;
	cursor?: string;
	limit?: number;
}

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
			canAttach: false,
			canDetach: false,
			canMove: false,
			canDelete: false
		};
	}
	const canEdit = isActionAllowed(role, 'media:manage');
	const isAttached = row.entityId !== null;
	return {
		canPreview: true,
		canRename: canEdit,
		canAttach: canEdit && !isAttached,
		canDetach: canEdit && isAttached,
		canMove: canEdit && isAttached,
		canDelete: canDeleteMedia({ role, userId }, row.uploadedBy)
	};
}

function fileDto(
	row: MediaItemRow,
	tree: CallerTree,
	attachedTo: string | null,
	uploadedBy: string | null,
	userId: string
): FileRowDto {
	return {
		id: row.id,
		title: row.title,
		mimeType: row.mimeType,
		sizeBytes: row.sizeBytes,
		treeId: row.treeId,
		treeName: tree.name,
		attachedTo,
		uploadedBy,
		createdAt: row.createdAt ? row.createdAt.getTime() : null,
		...rightsOf(row, tree.role, userId)
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
	 * Throws unless the caller may read this object. A key that is not ours, or whose row they cannot
	 * see, is a missing object. The tree is checked before the row is read, so a caller outside the
	 * tree is refused without learning whether a key exists in it.
	 */
	async requireRead(key: string, context: AuthenticatedContext): Promise<void> {
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
		const owners = scope.isRestricted ? await this.ownersOf(row) : null;
		const visible =
			owners && owners.length > 0
				? await visibleAmong(this.db, parsed.treeId, owners, scope)
				: new Set<string>();
		if (!canReadRow(owners, scope, visible)) throw new NotFoundError('Media', key);
	}

	/** The people a file hangs off: null when detached, [] when its owner is gone. */
	private async ownersOf(row: MediaItemRow): Promise<string[] | null> {
		if (row.entityId === null) return null;
		const owner = await this.media.ownerOf(row.treeId, row.entityId);
		if (!owner) return [];
		return owner.kind === 'person' ? [owner.id] : this.media.partnerIds(owner.id);
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
	 * racing at the edge can both pass; the quota is soft and that overshoot is accepted. Call only
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
	 * lookup (a detached file, a person, a partnership, a partnership with no partners), so the list
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
			if (tree.role === null) return fileDto(row, tree, null, null, context.user.id);
			const view = views.get(row.treeId);
			if (!view || !canReadRow(view.ownersOf(row), view, view.visible)) return null;
			const attachedTo = row.entityId === null ? null : (view.labels.get(row.entityId) ?? null);
			const uploadedBy =
				row.uploadedBy !== null && isManagerRole(tree.role)
					? (uploaders.get(row.uploadedBy) ?? null)
					: null;
			return fileDto(row, tree, attachedTo, uploadedBy, context.user.id);
		});
	}

	/**
	 * What one tree's rows need to be decided: the owner of each file, which of the people involved
	 * the caller may see, and the names to show. Restricted viewers get a visibility check; everyone
	 * else sees every person, so only names are needed.
	 */
	private async viewOf(
		treeId: string,
		role: TreeRole,
		rows: MediaItemRow[],
		context: AuthenticatedContext
	): Promise<TreeView> {
		const entityIds = [
			...new Set(
				rows
					.filter((r) => r.treeId === treeId)
					.map((r) => r.entityId)
					.filter((id): id is string => id !== null)
			)
		];
		const kinds = await this.media.recordKindsOf(treeId, entityIds);
		const unionIds = entityIds.filter((id) => kinds.get(id) === 'union');
		const partners = await this.media.partnersOf(unionIds);
		const personIds = new Set<string>();
		for (const id of entityIds) {
			if (kinds.get(id) === 'person') personIds.add(id);
		}
		for (const list of partners.values()) for (const id of list) personIds.add(id);
		const isRestricted = !canSeePrivatePeople(role);
		const scope = isRestricted
			? await requireTreeScope(this.users, this.trees, treeId, context, 'media:view', this.now())
			: null;
		const visible = scope
			? await visibleAmong(this.db, treeId, [...personIds], scope)
			: new Set<string>();
		const names = await this.media.personNamesOf(treeId, [...personIds]);
		const labels = new Map<string, string>();
		for (const id of entityIds) {
			if (kinds.get(id) === 'person') labels.set(id, names.get(id) ?? 'Unknown');
			if (kinds.get(id) === 'union') {
				const partnerNames = (partners.get(id) ?? []).map((p) => names.get(p) ?? 'Unknown');
				labels.set(id, partnerNames.length > 0 ? partnerNames.join(' and ') : 'A partnership');
			}
		}
		return {
			isRestricted,
			visible,
			labels,
			ownersOf: (row: MediaItemRow) => {
				if (row.entityId === null) return null;
				const kind = kinds.get(row.entityId);
				if (kind === 'person') return [row.entityId];
				if (kind === 'union') return partners.get(row.entityId) ?? [];
				return [];
			}
		};
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

	/** Attach a detached file to a person or partnership in the same tree. */
	attach(context: AuthenticatedContext, input: FileAttachInput): Promise<MutationResult> {
		return this.editFile(input.treeId, context, {
			kind: 'attach_media',
			mediaId: input.mediaId,
			entityId: input.entityId,
			expectedVersion: input.expectedVersion
		});
	}

	/** Detach a file from its person or partnership; the file itself is kept. */
	detach(context: AuthenticatedContext, input: FileDetachInput): Promise<MutationResult> {
		return this.editFile(input.treeId, context, {
			kind: 'detach_media',
			mediaId: input.mediaId,
			expectedVersion: input.expectedVersion
		});
	}

	/**
	 * Move an attached file to another person in the same tree: a detach and an attach in one logged
	 * change. A partnership is not a destination, and a detached file is attached rather than moved.
	 */
	async move(context: AuthenticatedContext, input: FileAttachInput): Promise<MutationResult> {
		requireRealUser(context);
		await requireTreeScope(
			this.users,
			this.trees,
			input.treeId,
			context,
			'media:manage',
			this.now()
		);
		const destination = await this.media.recordKindsOf(input.treeId, [input.entityId]);
		if (destination.get(input.entityId) !== 'person')
			throw new ValidationError('A file can only be moved to a person in the same tree');
		const file = await this.media.findById(input.mediaId);
		if (!file || file.treeId !== input.treeId) throw new NotFoundError('File', input.mediaId);
		if (file.entityId === null)
			throw new ValidationError('This file is not attached to anyone, so attach it instead');
		return this.editFile(input.treeId, context, {
			kind: 'attach_media',
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

	record(treeId: string, entityId: string, media: StoredMedia): Promise<void> {
		return this.media.insert(treeId, entityId, media);
	}
}
