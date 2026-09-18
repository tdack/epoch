import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { trees } from './trees';

// Media Links (Cloudflare R2/Images metadata)
export const mediaItems = sqliteTable('media_items', {
  id: text('id').primaryKey(),
  treeId: text('tree_id').notNull().references(() => trees.id, { onDelete: 'cascade' }),
  entityId: text('entity_id').notNull(),
  r2ObjectKey: text('r2_object_key').notNull(),
  cfImageId: text('cf_image_id'),
  title: text('title'),
  mimeType: text('mime_type').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => ({
  entityIdx: index('idx_media_entity').on(table.entityId),
  treeIdx: index('idx_media_tree').on(table.treeId)
}));
