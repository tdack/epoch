import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { trees } from './trees';

// Media (Cloudflare R2/Images metadata). Ownership lives in `media_links`, not in the R2 key: a
// file with no link is detached and stays visible only to editors and above.
export const mediaItems = sqliteTable(
	'media_items',
	{
		id: text('id').primaryKey(),
		treeId: text('tree_id')
			.notNull()
			.references(() => trees.id, { onDelete: 'cascade' }),
		r2ObjectKey: text('r2_object_key').notNull(),
		cfImageId: text('cf_image_id'),
		title: text('title'),
		mimeType: text('mime_type').notNull(),
		// Null for rows written before the column existed until the size backfill runs.
		sizeBytes: integer('size_bytes'),
		// No FK, like change_log.actor: the uploader may be removed without losing the file.
		uploadedBy: text('uploaded_by'),
		version: integer('version').notNull().default(1),
		createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
		updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
	},
	(table) => ({
		treeIdx: index('idx_media_tree').on(table.treeId),
		treeKeyIdx: index('idx_media_tree_key').on(table.treeId, table.r2ObjectKey)
	})
);

// A file linked to a record. `id` is `<mediaId>:<entityId>` so the change log can address a link
// by one key and an undo that re-creates an existing link refuses instead of duplicating it.
// `entityId` names a person, a union or a source with no foreign key, as `media_items.entity_id` did.
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
		createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
	},
	(table) => ({
		mediaEntityIdx: uniqueIndex('idx_media_links_media_entity').on(table.mediaId, table.entityId),
		treeEntityIdx: index('idx_media_links_tree_entity').on(table.treeId, table.entityId)
	})
);
