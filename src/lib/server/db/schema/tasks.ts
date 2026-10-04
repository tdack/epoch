import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { TASK_STATUS_VALUES, TASK_SUBJECT_KIND_VALUES } from '../../../shared/tasks';
import { trees } from './trees';

/**
 * Research tasks (ADR-029): Epoch's own to-do items, attached to records and to quality findings.
 * Not exported (GEDCOM has no home for one), but part of the change log: a task is created, edited
 * and removed through the mutation runner, so each change is logged and undoable like any other.
 *
 * `subject_id` has no foreign key (it points into five tables); the commands that delete or merge a
 * record move or clear its tasks themselves, in the same logged change. `assignee_id` and
 * `created_by` have none either: a member who leaves must not cascade to their tasks, and reads
 * treat an assignee who is no longer a member as nobody. `link_cleared_kind` is the kind of record
 * a task was about when that record was deleted, and says so on the task without naming it, which
 * could name a private person to everyone who may see an unlinked task.
 */
export const researchTasks = sqliteTable(
	'research_tasks',
	{
		id: text('id').primaryKey(),
		treeId: text('tree_id')
			.notNull()
			.references(() => trees.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		details: text('details'),
		status: text('status', { enum: TASK_STATUS_VALUES }).notNull().default('open'),
		assigneeId: text('assignee_id'),
		// A calendar date, `YYYY-MM-DD`.
		dueDate: text('due_date'),
		subjectKind: text('subject_kind', { enum: TASK_SUBJECT_KIND_VALUES }),
		subjectId: text('subject_id'),
		// The quality finding it was made from, by the key `quality_dismissals` uses.
		findingKey: text('finding_key'),
		linkClearedKind: text('link_cleared_kind', { enum: TASK_SUBJECT_KIND_VALUES }),
		createdBy: text('created_by'),
		version: integer('version').notNull().default(1),
		createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
		updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
	},
	(table) => ({
		// The tasks page: a status, open by default, in due order, paged.
		statusIdx: index('idx_task_status').on(table.treeId, table.status, table.dueDate, table.id),
		subjectIdx: index('idx_task_subject').on(table.subjectKind, table.subjectId),
		assigneeIdx: index('idx_task_assignee').on(table.treeId, table.assigneeId, table.status),
		findingIdx: index('idx_task_finding').on(table.treeId, table.findingKey)
	})
);
