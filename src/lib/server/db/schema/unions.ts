import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { trees } from './trees';
import { individuals } from './people';

// Families (@F123@) — legacy gendered schema, being replaced by the neutral
// union model below. Kept during the expand-and-contract migration.
export const families = sqliteTable('families', {
  id: text('id').primaryKey(),
  treeId: text('tree_id').notNull().references(() => trees.id, { onDelete: 'cascade' }),
  xrefId: text('xref_id'), // Preserved GEDCOM XREF (@F1@)
  husbandId: text('husband_id').references(() => individuals.id, { onDelete: 'set null' }),
  wifeId: text('wife_id').references(() => individuals.id, { onDelete: 'set null' }),
  version: integer('version').notNull().default(1),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
}, (table) => ({
  treeIdx: index('idx_fam_tree').on(table.treeId),
  husbandIdx: index('idx_fam_husband').on(table.husbandId),
  wifeIdx: index('idx_fam_wife').on(table.wifeId)
}));

// Legacy Family Children Junction
export const familyChildren = sqliteTable('family_children', {
  familyId: text('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
  childId: text('child_id').notNull().references(() => individuals.id, { onDelete: 'cascade' }),
  pedigree: text('pedigree', { enum: ['birth', 'adopted', 'foster'] }).default('birth'),
}, (table) => ({
  famChildIdx: index('idx_fam_child').on(table.familyId, table.childId),
  childIdx: index('idx_child').on(table.childId),
  uniqueFamChild: uniqueIndex('idx_uq_fam_child').on(table.familyId, table.childId)
}));

// Phase 1 neutral model tables. These coexist with the legacy gendered tables
// during the expand-and-contract migration and do not reinterpret them.

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
