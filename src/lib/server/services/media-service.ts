/**
 * Who may read or add a media object (Phase 4 items 3 and 10). R2 keys are `media/<tree>/<record>/…`;
 * the key alone is never a credential, so a read is checked against the tree and against the
 * record the object belongs to, and a private person's media answers as a missing object.
 */

import type { DbClient } from '../db';
import { NotFoundError, ValidationError } from '../domain/errors';
import type { AuthenticatedContext } from '../domain/identity';
import { MediaRepository, type StoredMedia } from '../repositories/media-repository';
import { TreeRepository } from '../repositories/tree-repository';
import { UserRepository } from '../repositories/user-repository';
import { visibleAmong } from '../repositories/visibility';
import { requireTreeScope } from './tree-access';

/** `media/<treeId>/<recordId>/<file>`; ids contain no slash. */
export function parseMediaKey(key: string): { treeId: string; entityId: string } | null {
	const [prefix, treeId, entityId, file, ...rest] = key.split('/');
	if (prefix !== 'media' || !treeId || !entityId || !file || rest.length > 0) return null;
	return { treeId, entityId };
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

	/** Throws unless the caller may read this object. A key that is not ours, or whose record they cannot see, is a missing object. */
	async requireRead(key: string, context: AuthenticatedContext): Promise<void> {
		const parsed = parseMediaKey(key);
		if (!parsed) throw new NotFoundError('Media', key);
		const scope = await requireTreeScope(this.users, this.trees, parsed.treeId, context, 'media:view', this.now());
		if (!scope.isRestricted) return;
		const owner = await this.media.ownerOf(parsed.treeId, parsed.entityId);
		if (!owner) throw new NotFoundError('Media', key);
		const people = owner.kind === 'person' ? [owner.id] : await this.media.partnerIds(owner.id);
		const seen = await visibleAmong(this.db, parsed.treeId, people, scope);
		if (people.length === 0 || people.some((id) => !seen.has(id))) throw new NotFoundError('Media', key);
	}

	/** Throws unless the caller may add media to this record of this tree. */
	async requireUpload(treeId: string, entityId: string, context: AuthenticatedContext): Promise<void> {
		await requireTreeScope(this.users, this.trees, treeId, context, 'media:manage', this.now());
		if (!(await this.media.ownerOf(treeId, entityId))) throw new ValidationError('The record to attach media to is not in this tree');
	}

	record(treeId: string, entityId: string, media: StoredMedia): Promise<void> {
		return this.media.insert(treeId, entityId, media);
	}
}
