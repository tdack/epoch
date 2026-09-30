import { sql } from 'drizzle-orm';
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
  xrefIdx: index('idx_ind_xref').on(table.treeId, table.xrefId),
  // The individuals list pages in name order. Without these every page sorted the whole tree
  // (2x the tree's rows read, at any offset); with them the first page reads a page (query-plans.md).
  // `id` ends each so the order is total and the index covers the page query.
  surnameOrderIdx: index('idx_ind_tree_surname').on(table.treeId, sql`${table.surname} collate nocase`, sql`${table.givenName} collate nocase`, table.id),
  givenOrderIdx: index('idx_ind_tree_given').on(table.treeId, sql`${table.givenName} collate nocase`, sql`${table.surname} collate nocase`, table.id)
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
  // NICK and SPFX have no neutral home of their own; they are name parts, so they live on the name.
  nickname: text('nickname'),
  surnamePrefix: text('surname_prefix'),
  // The TYPE word of a free-text 5.5.1 type (or a 7.0 PHRASE) under type `other`, so export writes it back.
  gedcomType: text('gedcom_type'),
  // Sub-structures of the NAME the model has no column for (NOTE, SOUR, custom tags), verbatim and
  // headed by nothing: they are written back inside this NAME. A column rather than gedcom_preserved
  // so they follow the row through edits, reorders, deletion and undo (ADR-013).
  gedcomExtra: text('gedcom_extra', { mode: 'json' }).$type<string[]>(),
  // Married when? The optional "from" date, in the same columns as an event's date (ADR-004).
  dateRaw: text('date_raw'),
  dateSort: text('date_sort'),
  dateSortEnd: text('date_sort_end'),
  dateQualifier: text('date_qualifier', {
    enum: ['EXACT', 'ABOUT', 'ESTIMATED', 'CALCULATED', 'BEFORE', 'AFTER', 'BETWEEN', 'FROM_TO', 'PHRASE', 'UNKNOWN']
  }),
  datePrecision: text('date_precision', { enum: ['DAY', 'MONTH', 'YEAR', 'NONE'] }),
  dateCalendar: text('date_calendar', {
    enum: ['GREGORIAN', 'JULIAN', 'HEBREW', 'FRENCH_REPUBLICAN', 'UNKNOWN']
  }),
  // The partnership this name came from. Deliberately no foreign key: a cascade or SET NULL would
  // change the row outside the logged ops, and undo could not restore it. Commands that delete or
  // merge a union rewrite this column themselves.
  unionId: text('union_id'),
  isPreferred: integer('is_preferred', { mode: 'boolean' }).notNull().default(false),
  order: integer('order').notNull().default(0),
  version: integer('version').notNull().default(1),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
}, (table) => ({
  personIdx: index('idx_person_name_person').on(table.personId)
}));
