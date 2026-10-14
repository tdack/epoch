/**
 * Who may read or add a media object (Phase 4 items 3 and 10). The key alone is never a credential:
 * a read is checked against the tree, then against the row that owns the object, and a private
 * person's media answers as a missing object. Ownership is the row's `entity_id`, not the key.
 */

import type { R2Bucket } from '@cloudflare/workers-types';
import type { DbClient } from '../db';
import { NotFoundError, PayloadTooLargeError, ValidationError } from '../domain/errors';
import type { AuthenticatedContext } from '../domain/identity';
import { sumStoredBytes } from '../media/stored-bytes';
import {
	MediaRepository,
	type MediaItemRow,
	type StoredMedia
} from '../repositories/media-repository';
import { TreeRepository } from '../repositories/tree-repository';
import { MAX_TREE_MEDIA_BYTES } from '../../shared/media';
import { UserRepository } from '../repositories/user-repository';
import { visibleAmong } from '../repositories/visibility';
import { hasMinimumRole } from '../../shared/roles';
import { requireTreeScope, type ViewerScope } from './tree-access';

/**
 * Reads the tree from a key. Current keys are `media/<treeId>/<mediaId>.<ext>`; legacy keys are
 * `media/<treeId>/<entityId>/<file>` and keep working because existing objects are not moved. The
 * owner is never read from the key, so the shape only has to be a key this app wrote. Ids contain
 * no slash.
 */
export function parseMediaKey(key: string): { treeId: string } | null {
	const [prefix, treeId, ...rest] = key.split('/');
	if (prefix !== 'media' || !treeId || rest.length < 1 || rest.length > 2) return null;
	if (rest.some((segment) => segment === '')) return null;
	return { treeId };
}

/**
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
 * Whether the viewer may delete a file attached to a person. Editors may delete the files they
 * uploaded; a manager may delete any. A file with no recorded uploader (every file uploaded before
 * migration 0029) is a manager's to delete.
 */
export function canDeleteMedia(
	scope: Pick<ViewerScope, 'role' | 'userId'>,
	uploadedBy: string | null
): boolean {
	if (!hasMinimumRole(scope.role, 'editor')) return false;
	return hasMinimumRole(scope.role, 'manager') || uploadedBy === scope.userId;
}

export class MediaService {
	private media: MediaRepository;
	private users: UserRepository;
	private trees: TreeRepository;

	constructor(
		private db: DbClient,
		private now: () => Date = () => new Date()
	) {
		this.media = new MediaRepository(db);
		this.users = new UserRepository(db);
		this.trees = new TreeRepository(db);
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

	record(treeId: string, entityId: string, media: StoredMedia): Promise<void> {
		return this.media.insert(treeId, entityId, media);
	}
}
