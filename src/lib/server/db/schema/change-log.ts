import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';
import { trees } from './trees';

// Append-only record of every tree mutation (ADR-007). Rows are inserted, never updated or
// deleted, except by the cascade when the whole tree is deleted. An undo is a new row whose
// `reverts_change_id` names the change it reverses, so "already undone" is derived, not stored.
export const changeLog = sqliteTable('change_log', {
  // Monotonic ordering. Timestamps collide within a millisecond; `seq` never does.
  seq: integer('seq').primaryKey({ autoIncrement: true }),
  // Generated before the write so the batch can point child rows at it without reading `seq` back.
  id: text('id').notNull().unique(),
  treeId: text('tree_id').notNull().references(() => trees.id, { onDelete: 'cascade' }),
  // users.id, deliberately without a foreign key so the log outlives a removed user.
  actorId: text('actor_id').notNull(),
  // Intent or mutation kind, e.g. `add_parent`, `update_person`, `undo`.
  kind: text('kind').notNull(),
  summary: text('summary').notNull(),
  // Per-record before/after field summary for display and audit (JSON).
  changesJson: text('changes_json').notNull(),
  // The exact row operations that revert this change (JSON); null when it cannot be undone.
  inverseJson: text('inverse_json'),
  revertsChangeId: text('reverts_change_id'),
  correlationId: text('correlation_id'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date())
}, (table) => ({
  treeSeqIdx: index('idx_change_log_tree_seq').on(table.treeId, table.seq),
  actorIdx: index('idx_change_log_actor').on(table.treeId, table.actorId, table.seq),
  // A change can be reverted once; the database enforces it so concurrent undos cannot both win.
  revertsUnique: uniqueIndex('idx_uq_change_log_reverts').on(table.revertsChangeId).where(sql`${table.revertsChangeId} is not null`)
}));

// The records a change wrote. "Did a later change touch the same records?" is one indexed lookup
// here, and Phase 4's per-record history reads the same rows.
export const changeLogRecords = sqliteTable('change_log_records', {
  changeId: text('change_id').notNull().references(() => changeLog.id, { onDelete: 'cascade' }),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull()
}, (table) => ({
  pk: primaryKey({ columns: [table.changeId, table.entityType, table.entityId] }),
  entityIdx: index('idx_change_log_records_entity').on(table.entityId)
}));
