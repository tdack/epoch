/**
 * Persists a parsed file's media records and the pointers to them (ADR-082).
 *
 * An import never fetches anything, so every `FILE` becomes an unresolved `media_items` row that
 * keeps its path as written; a `.gdz` resolves them later. Rows go in as the object first, then
 * its files, then the links, because `object_id` is a foreign key. Until the contract migrations
 * an object's id is its first file's id.
 *
 * Identity on a merge or replace import (a replace keeps the tree's objects and files): an object
 * is the same record when its xref is already in the tree, else when its first file's path is the first file's path of a stored object, as sources
 * match by xref (ADR-028). A matched object gains only the files and links it lacks.
 */

import { eq, getTableColumns, sql } from 'drizzle-orm';
import type { DbClient } from '../db';
import { mediaItems, mediaLinks, mediaObjects } from '../db/schema';
import { mediaLinkId, objectIdOf } from '../../shared/media';
import { normalisedFilePath } from '../gedcom/media-parse';
import type { ParsedGedcomData, ParsedMediaLink } from '../gedcom/parser';
import type { ImportBatch } from './import-batch';
import { objectValues, unresolvedFileValues } from './media-repository';
import { chunkByParamLimit } from './param-chunks';

/** The pointers a host (a person, partnership, source, or a fact of one) holds, and its stored id. */
export interface MediaTarget {
	/** The host's stored id; for a fact, its owner's. */
	entityId: string;
	/** The stored fact the pointers sit under, or absent for the host itself. */
	factId?: string;
	links: ParsedMediaLink[];
}

/** What a merge-mode import finds already stored for one object. */
interface StoredObject {
	id: string;
	fileCount: number;
	paths: Set<string>;
}

async function storedObjects(db: DbClient, treeId: string) {
	const byXref = new Map<string, StoredObject>();
	const byFirstPath = new Map<string, StoredObject>();
	const objects = new Map<string, StoredObject>();
	const rows = await db.select().from(mediaObjects).where(eq(mediaObjects.treeId, treeId)).all();
	for (const row of rows) {
		const stored = { id: row.id, fileCount: 0, paths: new Set<string>() };
		objects.set(row.id, stored);
		if (row.xref) byXref.set(row.xref, stored);
	}
	const files = await db
		.select()
		.from(mediaItems)
		.where(eq(mediaItems.treeId, treeId))
		.orderBy(sql`coalesce(${mediaItems.sortOrder}, 0)`, sql`${mediaItems}.rowid`)
		.all();
	for (const file of files) {
		// A file the backfill has not reached is an object of its own.
		const stored = objects.get(objectIdOf(file));
		if (!stored) continue;
		if (stored.fileCount === 0 && file.gedcomPath) {
			const key = normalisedFilePath(file.gedcomPath);
			if (!byFirstPath.has(key)) byFirstPath.set(key, stored);
		}
		stored.fileCount++;
		if (file.gedcomPath) stored.paths.add(normalisedFilePath(file.gedcomPath));
	}
	return { byXref, byFirstPath };
}

/**
 * Queue the writes for the file's media records and for `targets`, the pointers every host of the
 * file holds. The caller has already queued the replace-mode wipe, which clears the links and
 * keeps the objects and files.
 */
export async function importMedia(
	db: DbClient,
	treeId: string,
	parsed: ParsedGedcomData,
	targets: readonly MediaTarget[],
	{ writes, isNewTree }: ImportBatch
): Promise<void> {
	if (parsed.media.length === 0) return;
	const stored = isNewTree
		? { byXref: new Map<string, StoredObject>(), byFirstPath: new Map<string, StoredObject>() }
		: await storedObjects(db, treeId);
	const importedAt = new Date();

	const objectRows: Array<typeof mediaObjects.$inferInsert> = [];
	const fileRows: Array<typeof mediaItems.$inferInsert> = [];
	const objectIds = new Map<string, string>();
	for (const object of parsed.media) {
		const first = object.files[0];
		const match =
			(object.xref ? stored.byXref.get(object.xref) : undefined) ??
			(first ? stored.byFirstPath.get(normalisedFilePath(first.path)) : undefined);
		// A file the stored object does not have yet joins it, after the ones it has.
		let objectId = match?.id;
		let order = match?.fileCount ?? 0;
		const lacking = match
			? object.files.filter((f) => !match.paths.has(normalisedFilePath(f.path)))
			: object.files;
		if (!objectId) {
			objectId = crypto.randomUUID();
			objectRows.push(
				objectValues(
					treeId,
					objectId,
					{
						xref: object.xref ?? null,
						privacy: object.privacy ?? 'auto',
						gedcomExtra: object.extra.length > 0 ? object.extra : null
					},
					importedAt
				)
			);
		}
		objectIds.set(object.key, objectId);
		const isNew = !match;
		lacking.forEach((file, index) => {
			// The first file of a new object takes the object's id (the expand-phase rule).
			const id = isNew && index === 0 ? objectId : crypto.randomUUID();
			fileRows.push(
				unresolvedFileValues(
					treeId,
					{
						id,
						objectId,
						gedcomPath: file.path,
						mimeType: file.mimeType,
						title: file.title,
						medium: file.medium,
						sortOrder: order++,
						gedcomExtra: file.extra
					},
					importedAt
				)
			);
		});
		if (match) {
			for (const file of lacking) match.paths.add(normalisedFilePath(file.path));
			match.fileCount = order;
		}
	}

	const linkRows: Array<typeof mediaLinks.$inferInsert> = [];
	for (const target of targets) {
		target.links.forEach((link, position) => {
			const mediaId = objectIds.get(link.objectKey);
			if (!mediaId) return;
			linkRows.push({
				id: mediaLinkId(mediaId, target.entityId, target.factId),
				treeId,
				mediaId,
				entityId: target.entityId,
				factId: target.factId ?? null,
				sortOrder: position,
				cropTop: link.crop?.top ?? null,
				cropLeft: link.crop?.left ?? null,
				cropHeight: link.crop?.height ?? null,
				cropWidth: link.crop?.width ?? null,
				title: link.title ?? null,
				gedcomExtra: link.extra.length > 0 ? link.extra : null,
				createdAt: importedAt
			});
		});
	}

	// Objects, then files, then links: each names the one before it.
	for (const chunk of chunkByParamLimit(
		objectRows,
		Object.keys(getTableColumns(mediaObjects)).length
	))
		writes.push(db.insert(mediaObjects).values(chunk).onConflictDoNothing());
	for (const chunk of chunkByParamLimit(fileRows, Object.keys(getTableColumns(mediaItems)).length))
		writes.push(db.insert(mediaItems).values(chunk).onConflictDoNothing());
	for (const chunk of chunkByParamLimit(linkRows, Object.keys(getTableColumns(mediaLinks)).length))
		writes.push(db.insert(mediaLinks).values(chunk).onConflictDoNothing());
}
