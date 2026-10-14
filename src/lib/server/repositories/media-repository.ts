/**
 * Media metadata. The bytes are in R2 under `media/<treeId>/<mediaId>.<ext>` (or the legacy
 * `media/<treeId>/<entityId>/<file>`); who a file belongs to is `media_items.entity_id`, never the key.
 */

import { and, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { DbClient } from '../db';
import { mediaItems } from '../db/schema';

export type MediaOwner = { kind: 'person'; id: string } | { kind: 'union'; id: string };

export type MediaItemRow = typeof mediaItems.$inferSelect;

export interface StoredMedia {
	id: string;
	objectKey: string;
	title: string;
	mimeType: string;
	sizeBytes: number;
	uploadedBy: string;
}

export class MediaRepository {
	constructor(private db: DbClient) {}

	/** What kind of record in this tree an id names, or null when it names none. */
	async ownerOf(treeId: string, entityId: string): Promise<MediaOwner | null> {
		const rows = await this.db.all<{ kind: 'person' | 'union' }>(sql`
			select 'person' as kind from individuals where tree_id = ${treeId} and id = ${entityId}
			union all
			select 'union' as kind from unions where tree_id = ${treeId} and id = ${entityId}`);
		return rows[0] ? { kind: rows[0].kind, id: entityId } : null;
	}

	/** The people in a partnership, for deciding whether its media may be seen. */
	async partnerIds(unionId: string): Promise<string[]> {
		const rows = await this.db.all<{ person_id: string }>(
			sql`select person_id from union_partners where union_id = ${unionId}`
		);
		return rows.map((r) => r.person_id);
	}

	async insert(treeId: string, entityId: string, media: StoredMedia): Promise<void> {
		await this.db.insert(mediaItems).values({
			id: media.id,
			treeId,
			entityId,
			r2ObjectKey: media.objectKey,
			title: media.title,
			mimeType: media.mimeType,
			sizeBytes: media.sizeBytes,
			uploadedBy: media.uploadedBy,
			createdAt: new Date(),
			updatedAt: new Date()
		});
	}

	/**
	 * The row for an object key, scoped to its tree. The key is looked up here rather than parsed
	 * for an owner: a legacy key names its owner, but the row is the only record of ownership now.
	 */
	async findByKey(treeId: string, objectKey: string): Promise<MediaItemRow | undefined> {
		return this.db
			.select()
			.from(mediaItems)
			.where(and(eq(mediaItems.treeId, treeId), eq(mediaItems.r2ObjectKey, objectKey)))
			.get();
	}

	async findById(mediaId: string): Promise<MediaItemRow | undefined> {
		return this.db.select().from(mediaItems).where(eq(mediaItems.id, mediaId)).get();
	}

	async exists(treeId: string, objectKey: string): Promise<boolean> {
		const row = await this.db
			.select({ id: mediaItems.id })
			.from(mediaItems)
			.where(and(eq(mediaItems.treeId, treeId), eq(mediaItems.r2ObjectKey, objectKey)))
			.get();
		return row !== undefined;
	}
}
