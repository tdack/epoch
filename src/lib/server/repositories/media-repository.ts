/**
 * Media metadata. The bytes are in R2 under `media/<treeId>/<mediaId>.<ext>` (or the legacy
 * `media/<treeId>/<entityId>/<file>`); who a file belongs to is `media_items.entity_id`, never the key.
 */

import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { DbClient } from '../db';
import {
	individuals,
	mediaItems,
	personNames,
	sources,
	unionPartners,
	unions,
	users
} from '../db/schema';
import { displayNameWith } from '../../shared/name-types';
import { sourceLabel } from '../../shared/evidence';

export type MediaOwnerKind = 'person' | 'union' | 'source';

export type MediaOwner = { kind: MediaOwnerKind; id: string };

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
		/** Only files hanging off this record. */
		entityId?: string;
		/** Only files with no owner. */
		isDetachedOnly?: boolean;
		after?: FileCursor;
		limit: number;
	}): Promise<MediaItemRow[]> {
		const createdKey = sql`coalesce(${mediaItems.createdAt}, 0)`;
		const conditions = [
			options.treeId === undefined ? undefined : eq(mediaItems.treeId, options.treeId),
			options.entityId === undefined ? undefined : eq(mediaItems.entityId, options.entityId),
			options.isDetachedOnly === true ? isNull(mediaItems.entityId) : undefined,
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

	/** Which of these ids are people, partnerships or sources in the tree. Ids named by no record are absent. */
	async recordKindsOf(
		treeId: string,
		ids: readonly string[]
	): Promise<Map<string, MediaOwnerKind>> {
		const kinds = new Map<string, MediaOwnerKind>();
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
			const library = await this.db
				.select({ id: sources.id })
				.from(sources)
				.where(and(eq(sources.treeId, treeId), inArray(sources.id, part)))
				.all();
			for (const row of library) kinds.set(row.id, 'source');
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

	/** How many files hang off each of these records, for the ones that have any. */
	async fileCountsOf(treeId: string, entityIds: readonly string[]): Promise<Map<string, number>> {
		const counts = new Map<string, number>();
		for (const part of chunks([...new Set(entityIds)])) {
			const rows = await this.db
				.select({ entityId: mediaItems.entityId, n: count() })
				.from(mediaItems)
				.where(and(eq(mediaItems.treeId, treeId), inArray(mediaItems.entityId, part)))
				.groupBy(mediaItems.entityId)
				.all();
			for (const row of rows) if (row.entityId !== null) counts.set(row.entityId, row.n);
		}
		return counts;
	}

	/** Titles of sources in the tree, keyed by source id, for naming what a file hangs off. */
	async sourceTitlesOf(treeId: string, sourceIds: readonly string[]): Promise<Map<string, string>> {
		const titles = new Map<string, string>();
		for (const part of chunks([...new Set(sourceIds)])) {
			const rows = await this.db
				.select()
				.from(sources)
				.where(and(eq(sources.treeId, treeId), inArray(sources.id, part)))
				.all();
			for (const row of rows) titles.set(row.id, sourceLabel(row));
		}
		return titles;
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
		const rows = await this.db.all<{ kind: MediaOwnerKind }>(sql`
			select 'person' as kind from individuals where tree_id = ${treeId} and id = ${entityId}
			union all
			select 'union' as kind from unions where tree_id = ${treeId} and id = ${entityId}
			union all
			select 'source' as kind from sources where tree_id = ${treeId} and id = ${entityId}`);
		return rows[0] ? { kind: rows[0].kind, id: entityId } : null;
	}

	/** The people in a partnership, for deciding whether its media may be seen. */
	async partnerIds(treeId: string, unionId: string): Promise<string[]> {
		const rows = await this.db.all<{ person_id: string }>(
			sql`select up.person_id from union_partners up join unions u on u.id = up.union_id
				where u.tree_id = ${treeId} and up.union_id = ${unionId}`
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

	/** Every object key a file row in the tree points at. */
	async keysInTree(treeId: string): Promise<Set<string>> {
		const rows = await this.db
			.select({ key: mediaItems.r2ObjectKey })
			.from(mediaItems)
			.where(eq(mediaItems.treeId, treeId))
			.all();
		return new Set(rows.map((row) => row.key));
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
