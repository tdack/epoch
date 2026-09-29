import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { trees } from './trees';

// Events (Births, Deaths, Marriages, Burials, and extensible GEDCOM types)
export const events = sqliteTable('events', {
  id: text('id').primaryKey(),
  treeId: text('tree_id').notNull().references(() => trees.id, { onDelete: 'cascade' }),
  entityType: text('entity_type', { enum: ['INDIVIDUAL', 'FAMILY'] }).notNull(),
  entityId: text('entity_id').notNull(),
  // Extensible GEDCOM event tags; stored as text rather than a closed enum so
  // unsupported/custom types survive import/export without loss.
  type: text('type').notNull(),
  dateRaw: text('date_raw'),
  dateSort: text('date_sort'), // inclusive lower bound, YYYY-MM-DD, for indexing
  // ADR-004. Null on rows written before these columns existed; readers fall back to parsing
  // `date_raw`, and scripts/backfill-event-dates.mjs fills them in.
  dateSortEnd: text('date_sort_end'), // inclusive upper bound; null when unbounded
  dateQualifier: text('date_qualifier', {
    enum: ['EXACT', 'ABOUT', 'ESTIMATED', 'CALCULATED', 'BEFORE', 'AFTER', 'BETWEEN', 'FROM_TO', 'PHRASE', 'UNKNOWN']
  }),
  datePrecision: text('date_precision', { enum: ['DAY', 'MONTH', 'YEAR', 'NONE'] }),
  dateCalendar: text('date_calendar', {
    enum: ['GREGORIAN', 'JULIAN', 'HEBREW', 'FRENCH_REPUBLICAN', 'UNKNOWN']
  }),
  place: text('place'),
  description: text('description'),
  version: integer('version').notNull().default(1),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
}, (table) => ({
  entityIdx: index('idx_event_entity').on(table.entityType, table.entityId),
  treeIdx: index('idx_event_tree').on(table.treeId)
}));
