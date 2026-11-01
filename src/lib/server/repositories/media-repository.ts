/**
 * Media metadata. The bytes are in R2 under `media/<treeId>/<mediaId>.<ext>` (or the legacy
 * `media/<treeId>/<entityId>/<file>`); who a file belongs to is its `media_links` rows, never the key.
 */

import { chunkIds } from './param-chunks';
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { DbClient } from '../db';
import {
	individuals,
	mediaItems,
	mediaLinks,
	mediaObjects,
	personNames,
	sources,
	unionPartners,
	unions,
	users
} from '../db/schema';
import { displayNameWith } from '../../shared/name-types';
import { sourceLabel } from '../../shared/evidence';
import { mediaLinkId, unresolvedMediaKey } from '../../shared/media';
import type { PersonPrivacy } from '../../shared/privacy';

export type MediaOwnerKind = 'person' | 'union' | 'source';

export type MediaOwner = { kind: MediaOwnerKind; id: string };

export type MediaItemRow = typeof mediaItems.$inferSelect;

/**
 * A file's object id in SQL: a null `object_id` is a file written before the backfill, and means an
 * object whose id is the file's own (ADR-082). The TypeScript twin is `objectIdOf`.
 */
const objectIdSql = sql`coalesce(${mediaItems.objectId}, ${mediaItems.id})`;

/** A `FILE` whose bytes are not in Epoch (ADR-082): a row with a placeholder key and no size. */
export interface UnresolvedFile {
	id: string;
	/** The object it belongs to. Its first file's id until the contract migrations. */
	objectId: string;
	/** The `FILE` text as written, never rewritten. */
	gedcomPath: string;
	mimeType: string;
	title?: string | null;
	medium?: string | null;
	sortOrder?: number | null;
	gedcomExtra?: string[] | null;
	uploadedBy?: string | null;
}

/** The record an unresolved file's object is created as, when the file is its first. */
export interface NewMediaObject {
	xref?: string | null;
	privacy?: PersonPrivacy;
	gedcomExtra?: string[] | null;
}

/**
 * The row for an unresolved file. A function of its own so the import can insert many in one
 * statement and an upload-free write (`insertUnresolved`) cannot drift from it.
 */
export function unresolvedFileValues(
	treeId: string,
	file: UnresolvedFile,
	now: Date = new Date()
): typeof mediaItems.$inferInsert {
	return {
		id: file.id,
		treeId,
		objectId: file.objectId,
		sortOrder: file.sortOrder ?? null,
		gedcomPath: file.gedcomPath,
		status: 'unresolved',
		r2ObjectKey: unresolvedMediaKey(file.id),
		title: file.title ?? null,
		mimeType: file.mimeType,
		medium: file.medium ?? null,
		gedcomExtra: file.gedcomExtra ?? null,
		uploadedBy: file.uploadedBy ?? null,
		createdAt: now,
		updatedAt: now
	};
}

/** The row for a new object record. */
export function objectValues(
	treeId: string,
	id: string,
	object: NewMediaObject = {},
	now: Date = new Date()
): typeof mediaObjects.$inferInsert {
	return {
		id,
		treeId,
		xref: object.xref ?? null,
		privacy: object.privacy ?? 'auto',
		gedcomExtra: object.gedcomExtra ?? null,
		createdAt: now,
		updatedAt: now
	};
}

export interface StoredMedia {
	id: string;
	objectKey: string;
	title: string;
	mimeType: string;
	sizeBytes: number;
	uploadedBy: string;
	/** Hex digest and CRC-32 when the upload computed them; null leaves the cache for the backfill. */
	sha256?: string | null;
	crc32?: number | null;
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
		/** Only objects hanging off this record. */
		entityId?: string;
		/** Only files linked to nothing. */
		isDetachedOnly?: boolean;
		after?: FileCursor;
		limit: number;
	}): Promise<MediaItemRow[]> {
		const createdKey = sql`coalesce(${mediaItems.createdAt}, 0)`;
		const conditions = [
			options.treeId === undefined ? undefined : eq(mediaItems.treeId, options.treeId),
			options.entityId === undefined
				? undefined
				: sql`exists (select 1 from media_links l where l.media_id = ${objectIdSql} and l.entity_id = ${options.entityId})`,
			options.isDetachedOnly === true
				? sql`not exists (select 1 from media_links l where l.media_id = ${objectIdSql})`
				: undefined,
			// One row per object: its first file (ADR-082). Ties on `sort_order` go to the lower id.
			sql`not exists (select 1 from media_items o where o.tree_id = ${mediaItems.treeId}
				and coalesce(o.object_id, o.id) = ${objectIdSql} and o.id <> ${mediaItems.id}
				and (coalesce(o.sort_order, 0), o.id) < (coalesce(${mediaItems.sortOrder}, 0), ${mediaItems.id}))`,
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
		for (const part of chunkIds([...new Set(ids)])) {
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

	/** The privacy and version of each of these objects; an object with no row yet (not backfilled) is absent, and reads as `auto`. */
	async objectsOf(
		treeId: string,
		objectIds: readonly string[]
	): Promise<Map<string, { privacy: PersonPrivacy; version: number }>> {
		const objects = new Map<string, { privacy: PersonPrivacy; version: number }>();
		for (const part of chunkIds([...new Set(objectIds)])) {
			const rows = await this.db
				.select({
					id: mediaObjects.id,
					privacy: mediaObjects.privacy,
					version: mediaObjects.version
				})
				.from(mediaObjects)
				.where(and(eq(mediaObjects.treeId, treeId), inArray(mediaObjects.id, part)))
				.all();
			for (const row of rows) objects.set(row.id, { privacy: row.privacy, version: row.version });
		}
		return objects;
	}

	/** The records each of these objects is linked to, keyed by object id; an object with no link is absent. A record linked twice (itself and a fact of it) is listed once. */
	async linksOf(treeId: string, mediaIds: readonly string[]): Promise<Map<string, string[]>> {
		const links = new Map<string, string[]>();
		for (const part of chunkIds([...new Set(mediaIds)])) {
			const rows = await this.db
				.select({ mediaId: mediaLinks.mediaId, entityId: mediaLinks.entityId })
				.from(mediaLinks)
				.where(and(eq(mediaLinks.treeId, treeId), inArray(mediaLinks.mediaId, part)))
				.orderBy(sql`${mediaLinks}.rowid`)
				.all();
			for (const row of rows) {
				const own = links.get(row.mediaId) ?? [];
				if (!own.includes(row.entityId)) links.set(row.mediaId, [...own, row.entityId]);
			}
		}
		return links;
	}

	/** The partners of each partnership, in partner order, for the partnerships that have any. */
	async partnersOf(unionIds: readonly string[]): Promise<Map<string, string[]>> {
		const partners = new Map<string, string[]>();
		for (const part of chunkIds([...new Set(unionIds)])) {
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
		for (const part of chunkIds([...new Set(personIds)])) {
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
		for (const part of chunkIds([...new Set(entityIds)])) {
			const rows = await this.db
				.select({ entityId: mediaLinks.entityId, n: count() })
				.from(mediaLinks)
				.where(and(eq(mediaLinks.treeId, treeId), inArray(mediaLinks.entityId, part)))
				.groupBy(mediaLinks.entityId)
				.all();
			for (const row of rows) counts.set(row.entityId, row.n);
		}
		return counts;
	}

	/** Titles of sources in the tree, keyed by source id, for naming what a file hangs off. */
	async sourceTitlesOf(treeId: string, sourceIds: readonly string[]): Promise<Map<string, string>> {
		const titles = new Map<string, string>();
		for (const part of chunkIds([...new Set(sourceIds)])) {
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
		for (const part of chunkIds([...new Set(userIds)])) {
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

	/**
	 * The object, its first file and the first link in one batch, in that order: `object_id` is a
	 * foreign key, so the object must exist before the file (ADR-082). For the whole expand phase the
	 * object's id is the file's id, which is why a legacy link needs no rewrite.
	 */
	async insert(treeId: string, entityId: string, media: StoredMedia): Promise<void> {
		const now = new Date();
		await this.db.batch([
			this.db.insert(mediaObjects).values({
				id: media.id,
				treeId,
				createdBy: media.uploadedBy,
				createdAt: now,
				updatedAt: now
			}),
			this.db.insert(mediaItems).values({
				id: media.id,
				treeId,
				objectId: media.id,
				r2ObjectKey: media.objectKey,
				title: media.title,
				mimeType: media.mimeType,
				sizeBytes: media.sizeBytes,
				sha256: media.sha256 ?? null,
				crc32: media.crc32 ?? null,
				uploadedBy: media.uploadedBy,
				createdAt: now,
				updatedAt: now
			}),
			this.db.insert(mediaLinks).values({
				id: mediaLinkId(media.id, entityId),
				treeId,
				mediaId: media.id,
				entityId,
				createdAt: now
			})
		]);
	}

	/**
	 * The statement for an unresolved file: a `FILE` whose bytes are not in Epoch. Its object must
	 * exist already (or be created earlier in the same batch). `status` is the one place a non-null
	 * `status` is written; a resolved file keeps it null (ADR-082).
	 */
	unresolvedFileStatement(treeId: string, file: UnresolvedFile, now: Date = new Date()) {
		return this.db.insert(mediaItems).values(unresolvedFileValues(treeId, file, now));
	}

	/** The statement for a new, empty object record. */
	objectStatement(treeId: string, id: string, object: NewMediaObject = {}, now: Date = new Date()) {
		return this.db.insert(mediaObjects).values(objectValues(treeId, id, object, now));
	}

	/**
	 * An object and its first, unresolved file in one batch. The object's id is the file's id, as for
	 * an upload (the expand-phase rule). Task 2.3's import builds the same two statements into its
	 * own batch with `objectStatement` and `unresolvedFileStatement`.
	 */
	async insertUnresolved(
		treeId: string,
		file: Omit<UnresolvedFile, 'objectId'>,
		object: NewMediaObject = {}
	): Promise<void> {
		const now = new Date();
		await this.db.batch([
			this.objectStatement(treeId, file.id, object, now),
			this.unresolvedFileStatement(treeId, { ...file, objectId: file.id }, now)
		]);
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
			.innerJoin(mediaLinks, sql`${mediaLinks.mediaId} = ${objectIdSql}`)
			.where(and(eq(mediaItems.treeId, treeId), eq(mediaLinks.entityId, entityId)))
			.all();
		return new Map(rows.map((row) => [row.id, row.uploadedBy]));
	}

	/** The files of an object, first first. A file not yet backfilled is its own object. */
	async filesOfObject(treeId: string, objectId: string): Promise<MediaItemRow[]> {
		return this.db
			.select()
			.from(mediaItems)
			.where(and(eq(mediaItems.treeId, treeId), sql`${objectIdSql} = ${objectId}`))
			.orderBy(sql`coalesce(${mediaItems.sortOrder}, 0)`, mediaItems.id)
			.all();
	}

	/**
	 * Removes an object's rows: its links, its files and the object, in one batch and in that order.
	 * The bytes are removed separately, after this, so a failure leaves an orphan the cleanup finds
	 * rather than a row that points at nothing. A file removed alone leaves the object and its other
	 * files.
	 */
	async deleteObjectRows(objectId: string): Promise<void> {
		// Links first, in the same batch: the cascade would do it, but a delete should not rest on it.
		await this.db.batch([
			this.db.delete(mediaLinks).where(eq(mediaLinks.mediaId, objectId)),
			this.db.delete(mediaItems).where(sql`${objectIdSql} = ${objectId}`),
			this.db.delete(mediaObjects).where(eq(mediaObjects.id, objectId))
		]);
	}

	/** Writes the derived size and CRC of a file whose bytes just arrived; a row image leaves both out. */
	async setStoredBytesInfo(
		mediaId: string,
		info: { sizeBytes: number; crc32: number | null }
	): Promise<void> {
		await this.db
			.update(mediaItems)
			.set({ sizeBytes: info.sizeBytes, crc32: info.crc32 })
			.where(eq(mediaItems.id, mediaId));
	}

	/** Removes one file's row and leaves its object, links and other files. */
	async deleteFileRow(mediaId: string): Promise<void> {
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
