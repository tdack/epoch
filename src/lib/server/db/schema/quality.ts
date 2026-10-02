import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { trees } from './trees';

/**
 * A data-quality finding someone has looked at and judged to be fine, with the reason (Phase 5).
 * Findings themselves are computed, never stored; only this decision is. It is shared by the whole
 * tree, because "this marriage date is right" is a fact about the tree and not about one viewer.
 *
 * Not in the change log: it changes no record, so there is nothing to undo, and restoring a
 * dismissed finding is one click. `finding_key` names the finding by rule and the records it is
 * about (`shared/quality.ts`), so it keeps matching until the data it was about changes shape.
 * `dismissed_by` has no foreign key: removing a user must not remove what they decided.
 */
export const qualityDismissals = sqliteTable('quality_dismissals', {
  id: text('id').primaryKey(),
  treeId: text('tree_id').notNull().references(() => trees.id, { onDelete: 'cascade' }),
  findingKey: text('finding_key').notNull(),
  reason: text('reason').notNull(),
  dismissedBy: text('dismissed_by').notNull(),
  /** Epoch milliseconds. */
  dismissedAt: integer('dismissed_at').notNull()
}, (table) => ({
  keyIdx: uniqueIndex('idx_quality_dismissal_key').on(table.treeId, table.findingKey)
}));
