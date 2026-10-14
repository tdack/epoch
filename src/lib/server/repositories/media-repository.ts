/**
 * Media metadata. The bytes are in R2 under `media/<treeId>/<mediaId>.<ext>` (or the legacy
 * `media/<treeId>/<entityId>/<file>`); who a file belongs to is `media_items.entity_id`, never the key.
 */

import { and, desc, eq, inArray } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { DbClient } from '../db';
import { individuals, mediaItems, personNames, unionPartners, unions, users } from '../db/schema';
import { displayNameWith } from '../../shared/name-types';

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

/** D1 caps bound parameters per statement at 100; a lookup by id list stays under it. */
const IDS_PER_QUERY = 90;

function chunks<T>(values: readonly T[]): T[][] {
	const parts: T[][] = [];
	for (let i = 0; i < values.length; i += IDS_PER_QUERY)
		parts.push(values.slice(i, i + IDS_PER_QUERY));
	return parts;
}

/** A position in the Files listing: the newest-first key of the last row scanned. */
export interface FileCursor {
	createdAt: number;
	id: string;
}

export class MediaRepository {
	constructor(private db: DbClient) {}

	/**
	 * Files newest first, after `after` when given. The key is the stored timestamp, which is whole
	 * seconds, with the id breaking ties, so the order is total and a cursor never skips a row.
	 */
	async listNewestFirst(options: {
		treeId?: string;
		after?: FileCursor;
		limit: number;
	}): Promise<MediaItemRow[]> {
		const createdKey = sql`coalesce(${mediaItems.createdAt}, 0)`;
		const conditions = [
			options.treeId === undefined ? undefined : eq(mediaItems.treeId, options.treeId),
			options.after === undefined
				? undefined
				: sql`(${createdKey}, ${mediaItems.id}) < (${options.after.createdAt}, ${options.after.id})`
		].filter((condition) => condition !== undefined);
		return this.db
			.select()
			.from(mediaItems)
			.where(conditions.length > 0 ? and(...conditions) : undefined)
			.orderBy(desc(createdKey), desc(mediaItems.id))
			.limit(options.limit)
			.all();
	}

	/** Which of these ids are people and which are partnerships in the tree. Ids named by no record are absent. */
	async recordKindsOf(
		treeId: string,
		ids: readonly string[]
	): Promise<Map<string, 'person' | 'union'>> {
		const kinds = new Map<string, 'person' | 'union'>();
		for (const part of chunks([...new Set(ids)])) {
			const people = await this.db
				.select({ id: individuals.id })
				.from(individuals)
				.where(and(eq(individuals.treeId, treeId), inArray(individuals.id, part)))
				.all();
			for (const row of people) kinds.set(row.id, 'person');
			const found = await this.db
				.select({ id: unions.id })
				.from(unions)
				.where(and(eq(unions.treeId, treeId), inArray(unions.id, part)))
				.all();
			for (const row of found) kinds.set(row.id, 'union');
		}
		return kinds;
	}

	/** The partners of each partnership, in partner order, for the partnerships that have any. */
	async partnersOf(unionIds: readonly string[]): Promise<Map<string, string[]>> {
		const partners = new Map<string, string[]>();
		for (const part of chunks([...new Set(unionIds)])) {
			const rows = await this.db
				.select({ unionId: unionPartners.unionId, personId: unionPartners.personId })
				.from(unionPartners)
				.where(inArray(unionPartners.unionId, part))
				.orderBy(unionPartners.order)
				.all();
			for (const row of rows)
				partners.set(row.unionId, [...(partners.get(row.unionId) ?? []), row.personId]);
		}
		return partners;
	}

	/** Display names of people in the tree, keyed by person id. */
	async personNamesOf(treeId: string, personIds: readonly string[]): Promise<Map<string, string>> {
		const names = new Map<string, string>();
		for (const part of chunks([...new Set(personIds)])) {
			const people = await this.db
				.select()
				.from(individuals)
				.where(and(eq(individuals.treeId, treeId), inArray(individuals.id, part)))
				.all();
			const rows = await this.db
				.select()
				.from(personNames)
				.where(inArray(personNames.personId, part))
				.all();
			for (const person of people) {
				const own = rows.filter((row) => row.personId === person.id);
				names.set(person.id, displayNameWith(person, own));
			}
		}
		return names;
	}

	/** Display names of the users who uploaded files, keyed by user id; a user with no name shows their email. */
	async uploaderNamesOf(userIds: readonly string[]): Promise<Map<string, string>> {
		const names = new Map<string, string>();
		for (const part of chunks([...new Set(userIds)])) {
			const rows = await this.db
				.select({ id: users.id, name: users.name, email: users.email })
				.from(users)
				.where(inArray(users.id, part))
				.all();
			for (const row of rows) names.set(row.id, row.name?.trim() || row.email);
		}
		return names;
	}

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

	/**
	 * Who uploaded each file attached to a person, keyed by media id. Read separately because the
	 * graph reads build row images, which leave the uploader out (see `MediaRow`).
	 */
	async uploadersOf(treeId: string, entityId: string): Promise<Map<string, string | null>> {
		const rows = await this.db
			.select({ id: mediaItems.id, uploadedBy: mediaItems.uploadedBy })
			.from(mediaItems)
			.where(and(eq(mediaItems.treeId, treeId), eq(mediaItems.entityId, entityId)))
			.all();
		return new Map(rows.map((row) => [row.id, row.uploadedBy]));
	}

	/** Removes the row. The object is removed separately, after this, so a failure leaves an orphan the cleanup finds rather than a row that points at nothing. */
	async deleteRow(mediaId: string): Promise<void> {
		await this.db.delete(mediaItems).where(eq(mediaItems.id, mediaId));
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
