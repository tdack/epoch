import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { SEX_VALUES } from '../../../shared/sex';
import { trees } from './trees';

// Individuals (@I123@)
export const individuals = sqliteTable('individuals', {
  id: text('id').primaryKey(), // UUID
  treeId: text('tree_id').notNull().references(() => trees.id, { onDelete: 'cascade' }),
  xrefId: text('xref_id'), // Preserved GEDCOM XREF (@I1@)
  givenName: text('given_name'),
  surname: text('surname'),
  sex: text('sex', { enum: SEX_VALUES }).default('U'),
  version: integer('version').notNull().default(1),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
}, (table) => ({
  treeIdx: index('idx_ind_tree').on(table.treeId),
  xrefIdx: index('idx_ind_xref').on(table.treeId, table.xrefId)
}));

// Multiple names per person, with a preferred display name.
export const personNames = sqliteTable('person_names', {
  id: text('id').primaryKey(),
  personId: text('person_id').notNull().references(() => individuals.id, { onDelete: 'cascade' }),
  type: text('type', { enum: ['birth', 'married', 'aka', 'immigrant', 'maiden', 'professional', 'other'] }).notNull().default('birth'),
  givenName: text('given_name'),
  surname: text('surname'),
  namePrefix: text('name_prefix'),
  nameSuffix: text('name_suffix'),
  isPreferred: integer('is_preferred', { mode: 'boolean' }).notNull().default(false),
  order: integer('order').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
}, (table) => ({
  personIdx: index('idx_person_name_person').on(table.personId)
}));
