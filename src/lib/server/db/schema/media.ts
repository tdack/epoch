import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { trees } from './trees';

// Media Links (Cloudflare R2/Images metadata). Ownership lives here, not in the R2 key: a
// null entityId is a detached file that stays visible only to editors and above.
export const mediaItems = sqliteTable(
	'media_items',
	{
		id: text('id').primaryKey(),
		treeId: text('tree_id')
			.notNull()
			.references(() => trees.id, { onDelete: 'cascade' }),
		entityId: text('entity_id'),
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
		entityIdx: index('idx_media_entity').on(table.entityId),
		treeIdx: index('idx_media_tree').on(table.treeId),
		treeKeyIdx: index('idx_media_tree_key').on(table.treeId, table.r2ObjectKey)
	})
);
