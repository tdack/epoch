import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { trees } from './trees';
import { individuals } from './people';

// Neutral model. The gendered legacy `families`/`family_children` tables were
// expunged; unions are the single source of truth for partnership/family
// episodes and parent-child assertions.

// Union: a partnership/family episode, never inferred to mean marriage.
export const unions = sqliteTable('unions', {
  id: text('id').primaryKey(),
  treeId: text('tree_id').notNull().references(() => trees.id, { onDelete: 'cascade' }),
  status: text('status', { enum: ['active', 'separated', 'divorced', 'annulled', 'ended'] }).notNull().default('active'),
  version: integer('version').notNull().default(1),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
}, (table) => ({
  treeIdx: index('idx_union_tree').on(table.treeId)
}));

// Union participants, ordered and role-neutral. GEDCOM spouse-role metadata is
// an interchange concern and is not stored here.
export const unionPartners = sqliteTable('union_partners', {
  id: text('id').primaryKey(),
  unionId: text('union_id').notNull().references(() => unions.id, { onDelete: 'cascade' }),
  personId: text('person_id').notNull().references(() => individuals.id, { onDelete: 'cascade' }),
  order: integer('order').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
}, (table) => ({
  unionIdx: index('idx_union_partner_union').on(table.unionId),
  personIdx: index('idx_union_partner_person').on(table.personId),
  unionPersonUnique: uniqueIndex('idx_uq_union_person').on(table.unionId, table.personId)
}));

// Direct parent-child assertion with neutral relationship type. Unlike the
// legacy family-wide `pedigree`, the type is asserted per parent.
export const parentChild = sqliteTable('parent_child', {
  id: text('id').primaryKey(),
  treeId: text('tree_id').notNull().references(() => trees.id, { onDelete: 'cascade' }),
  parentId: text('parent_id').notNull().references(() => individuals.id, { onDelete: 'cascade' }),
  childId: text('child_id').notNull().references(() => individuals.id, { onDelete: 'cascade' }),
  type: text('type', { enum: ['biological', 'adoptive', 'foster', 'guardian', 'unknown'] }).notNull().default('unknown'),
  status: text('status', { enum: ['active', 'ended', 'disputed'] }).notNull().default('active'),
  unionId: text('union_id').references(() => unions.id, { onDelete: 'set null' }),
  version: integer('version').notNull().default(1),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
}, (table) => ({
  treeIdx: index('idx_parent_child_tree').on(table.treeId),
  parentIdx: index('idx_parent_child_parent').on(table.parentId),
  childIdx: index('idx_parent_child_child').on(table.childId),
  unionIdx: index('idx_parent_child_union').on(table.unionId),
  // Same parent/child/type may be asserted only once; different types coexist.
  uniqueAssertion: uniqueIndex('idx_uq_parent_child_type').on(table.parentId, table.childId, table.type)
}));
