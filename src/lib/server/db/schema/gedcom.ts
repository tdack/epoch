import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { trees } from './trees';

// Unmodeled GEDCOM structures retained verbatim for lossless export (ADR-003).
// `owner_xref` is the owning record's XREF, or null for tree/header-level records.
export const gedcomPreserved = sqliteTable(
	'gedcom_preserved',
	{
		id: text('id').primaryKey(),
		treeId: text('tree_id')
			.notNull()
			.references(() => trees.id, { onDelete: 'cascade' }),
		ownerXref: text('owner_xref'),
		lines: text('lines', { mode: 'json' }).notNull(),
		order: integer('order').notNull().default(0),
		createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
	},
	(table) => ({
		treeIdx: index('idx_preserved_tree').on(table.treeId),
		ownerIdx: index('idx_preserved_owner').on(table.treeId, table.ownerXref)
	})
);
