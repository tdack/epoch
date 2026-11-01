import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { trees } from './trees';

// One GEDCOM import run. `id` is also the workflow instance id, so a status read and the run that
// writes it address the same key. `result` holds counts and `error` the failure message; both are
// written once the run ends. `r2_object_key` names the staged text the run reads.
export const importJobs = sqliteTable(
	'import_job',
	{
		id: text('id').primaryKey(),
		treeId: text('tree_id')
			.notNull()
			.references(() => trees.id, { onDelete: 'cascade' }),
		r2ObjectKey: text('r2_object_key').notNull(),
		status: text('status', { enum: ['pending', 'running', 'complete', 'failed'] })
			.notNull()
			.default('pending'),
		// JSON counts, null until the run completes.
		result: text('result'),
		error: text('error'),
		// No FK, like `media_items.uploaded_by`: the importer may leave the tree without losing the
		// record of what was imported.
		createdBy: text('created_by'),
		createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
		updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
	},
	(table) => ({
		treeCreatedIdx: index('idx_import_job_tree_created').on(table.treeId, table.createdAt)
	})
);
