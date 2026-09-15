import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

// Trees
export const trees = sqliteTable('trees', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
});

// Individuals (@I123@)
export const individuals = sqliteTable('individuals', {
  id: text('id').primaryKey(), // GEDCOM XREF ID or UUID
  treeId: text('tree_id').notNull().references(() => trees.id, { onDelete: 'cascade' }),
  givenName: text('given_name'),
  surname: text('surname'),
  sex: text('sex', { enum: ['M', 'F', 'U'] }).default('U'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => ({
  treeIdx: index('idx_ind_tree').on(table.treeId),
}));

// Families (@F123@)
export const families = sqliteTable('families', {
  id: text('id').primaryKey(),
  treeId: text('tree_id').notNull().references(() => trees.id, { onDelete: 'cascade' }),
  husbandId: text('husband_id').references(() => individuals.id, { onDelete: 'set null' }),
  wifeId: text('wife_id').references(() => individuals.id, { onDelete: 'set null' }),
}, (table) => ({
  treeIdx: index('idx_fam_tree').on(table.treeId),
  husbandIdx: index('idx_fam_husband').on(table.husbandId),
  wifeIdx: index('idx_fam_wife').on(table.wifeId)
}));

// Family Children Junction
export const familyChildren = sqliteTable('family_children', {
  familyId: text('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
  childId: text('child_id').notNull().references(() => individuals.id, { onDelete: 'cascade' }),
  pedigree: text('pedigree', { enum: ['birth', 'adopted', 'foster'] }).default('birth'),
}, (table) => ({
  famChildIdx: index('idx_fam_child').on(table.familyId, table.childId),
  childIdx: index('idx_child').on(table.childId)
}));

// Events (Births, Deaths, Marriages, Burials)
export const events = sqliteTable('events', {
  id: text('id').primaryKey(),
  treeId: text('tree_id').notNull().references(() => trees.id, { onDelete: 'cascade' }),
  entityType: text('entity_type', { enum: ['INDIVIDUAL', 'FAMILY'] }).notNull(),
  entityId: text('entity_id').notNull(),
  type: text('type', { enum: ['BIRT', 'DEAT', 'MARR', 'DIV', 'BAPM', 'BURI'] }).notNull(),
  dateRaw: text('date_raw'),
  dateSort: text('date_sort'), // YYYY-MM-DD for indexing
  place: text('place'),
  description: text('description'),
}, (table) => ({
  entityIdx: index('idx_event_entity').on(table.entityType, table.entityId),
  treeIdx: index('idx_event_tree').on(table.treeId)
}));

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
