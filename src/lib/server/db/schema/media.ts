import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { PERSON_PRIVACY_VALUES } from '../../../shared/privacy';
import { trees } from './trees';

// A GEDCOM `OBJE` record: the unit that is shared, and that owns one or more files (ADR-082). A
// 7.0 pointer names an object, not a file, so privacy, notes, citations and identifiers all hang
// off this row rather than off "the first file". An id is a UUID, never the xref, so a merge or a
// second import cannot collide (ADR-002).
export const mediaObjects = sqliteTable(
	'media_object',
	{
		id: text('id').primaryKey(), // UUID
		treeId: text('tree_id')
			.notNull()
			.references(() => trees.id, { onDelete: 'cascade' }),
		// Null for an embedded 5.5.1 `OBJE`, which has no xref to keep.
		xref: text('xref'),
		// ADR-015, as for people. A person's override beats it, because a photo of a private person is
		// not public whatever the object says (ADR-082).
		privacy: text('privacy', { enum: PERSON_PRIVACY_VALUES }).notNull().default('auto'),
		// Lines under the `OBJE` with no column (`EXID`, `UID`, `REFN`, `CHAN`, `CREA`, extensions).
		// JSON, as the other records keep theirs.
		gedcomExtra: text('gedcom_extra', { mode: 'json' }).$type<string[]>(),
		// No foreign key, like `media_items.uploaded_by`: the creator may be removed without losing
		// the record.
		createdBy: text('created_by'),
		version: integer('version').notNull().default(1),
		createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
		updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
	},
	(table) => ({
		treeIdx: index('idx_media_object_tree').on(table.treeId)
	})
);

// Media (Cloudflare R2/Images metadata). Ownership lives in `media_links`, not in the R2 key: a
// file with no link is detached and stays visible only to editors and above.
export const mediaItems = sqliteTable(
	'media_items',
	{
		id: text('id').primaryKey(),
		treeId: text('tree_id')
			.notNull()
			.references(() => trees.id, { onDelete: 'cascade' }),
		// The record this file belongs to. Null only until the backfill (ADR-082, step 3) gives every
		// existing file an object of its own; after it, the write path always sets it.
		objectId: text('object_id').references(() => mediaObjects.id, { onDelete: 'cascade' }),
		// The order of the `FILE`s under one object. Null means 0. No default: a change image written before
		// this column existed has no key for it, and a default would make the live row differ from that
		// image, so an undo of any earlier media change would be refused (ADR-082).
		sortOrder: integer('sort_order'),
		// The `FILE` text as the GEDCOM wrote it, kept verbatim so an export can write it back. Null
		// for a file uploaded in Epoch. Epoch never fetches it (ADR-082).
		gedcomPath: text('gedcom_path'),
		// `unresolved` marks a `FILE` whose bytes are not in Epoch. Null means `resolved`, which every existing row is.
		// No default, for the undo reason above. Its `r2_object_key` is a placeholder
		// that names no R2 object, so nothing serves or deletes it from the bucket (ADR-082).
		status: text('status', { enum: ['resolved', 'unresolved'] }),
		r2ObjectKey: text('r2_object_key').notNull(),
		cfImageId: text('cf_image_id'),
		title: text('title'),
		mimeType: text('mime_type').notNull(),
		// `MEDI`: the kind of source (photograph, document, ...), kept as the author wrote it.
		medium: text('medium'),
		// Null for rows written before the column existed until the size backfill runs.
		sizeBytes: integer('size_bytes'),
		// Hex SHA-256 of the bytes, and their unsigned 32-bit CRC. Both are caches, not promises: they
		// stay null until the upload or a backfill computes them, and a reader that needs one falls back
		// to reading the bytes. The zip writer needs the CRC for its entry header (ADR-082).
		sha256: text('sha256'),
		crc32: integer('crc32'),
		// Lines under the `FILE`, `FORM` and `MEDI` with no column (`TRAN`, `MEDI.PHRASE`, extensions).
		gedcomExtra: text('gedcom_extra', { mode: 'json' }).$type<string[]>(),
		// No foreign key, like change_log.actor: the uploader may be removed without losing the file.
		uploadedBy: text('uploaded_by'),
		version: integer('version').notNull().default(1),
		createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
		updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
	},
	(table) => ({
		treeIdx: index('idx_media_tree').on(table.treeId),
		treeKeyIdx: index('idx_media_tree_key').on(table.treeId, table.r2ObjectKey),
		// A `.gdz` import finds the row for each archive entry by its path (ADR-082, Phase 3).
		treeGedcomPathIdx: index('idx_media_tree_gedcom_path').on(table.treeId, table.gedcomPath)
	})
);

// A file linked to a record. `id` is `<mediaId>:<entityId>` for a record-level link and
// `<mediaId>:<entityId>:<factId>` for a link under a fact, so the change log can address a link by
// one key and an undo that re-creates an existing link refuses instead of duplicating it.
// `entityId` names a person, a union or a source with no foreign key, as `media_items.entity_id` did.
// A fact link keeps its owner in `entity_id`, so the privacy rule and the merges find it unchanged;
// `fact_id` only says where the pointer is written and shown (ADR-082).
export const mediaLinks = sqliteTable(
	'media_links',
	{
		id: text('id').primaryKey(),
		treeId: text('tree_id')
			.notNull()
			.references(() => trees.id, { onDelete: 'cascade' }),
		mediaId: text('media_id')
			.notNull()
			.references(() => mediaItems.id, { onDelete: 'cascade' }),
		entityId: text('entity_id').notNull(),
		// The event the pointer sits under, or null for a pointer on the record itself. No foreign key:
		// a fact delete removes its links in the same change, as it removes its citations (ADR-082).
		factId: text('fact_id'),
		// The pointer's place among its siblings under the same host. Null means 0; no default, for the same
		// undo reason as `media_items.sort_order`.
		sortOrder: integer('sort_order'),
		// `CROP` in whole pixels. All four are null for a link with no crop, which is most links, so
		// none is NOT NULL.
		cropTop: integer('crop_top'),
		cropLeft: integer('crop_left'),
		cropHeight: integer('crop_height'),
		cropWidth: integer('crop_width'),
		// The `TITL` that overrides the file's title for this use only.
		title: text('title'),
		// Lines under the pointer with no column, and a `CROP` that has no children to hold.
		gedcomExtra: text('gedcom_extra', { mode: 'json' }).$type<string[]>(),
		createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
	},
	(table) => ({
		// `coalesce` makes the null fact of every record-level link compare equal. A plain nullable
		// column in a unique index would not: SQLite treats two NULLs as distinct. The index it replaces
		// on `(media_id, entity_id)` is dropped by the same migration.
		mediaEntityFactIdx: uniqueIndex('idx_media_links_media_entity_fact').on(
			table.mediaId,
			table.entityId,
			sql`coalesce(${table.factId}, '')`
		),
		treeEntityIdx: index('idx_media_links_tree_entity').on(table.treeId, table.entityId)
	})
);
