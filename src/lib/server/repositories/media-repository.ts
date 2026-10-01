/** Media metadata (the bytes are in R2, under a key that names the tree and the record). */

import { and, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { DbClient } from '../db';
import { mediaItems } from '../db/schema';

export type MediaOwner = { kind: 'person'; id: string } | { kind: 'union'; id: string };

export interface StoredMedia {
	id: string;
	objectKey: string;
	title: string;
	mimeType: string;
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
		const rows = await this.db.all<{ person_id: string }>(sql`select person_id from union_partners where union_id = ${unionId}`);
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
			createdAt: new Date()
		});
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
