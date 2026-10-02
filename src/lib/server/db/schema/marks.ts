import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { trees } from './trees';
import { users } from './users';

/**
 * A person a user has marked in a tree: a favourite they chose, or a recent they opened (ADR-014).
 * Per user and per tree, so one person's shortcuts never show up for another.
 *
 * `person_id` deliberately has no foreign key to `individuals`: a cascade would delete the row
 * outside the logged ops, so deleting a person and then undoing it would lose the favourite
 * (the same reason as `person_names.union_id`, ADR-013). Reads join `individuals`, so a mark for a
 * person who is gone is simply not shown, and comes back when an undo restores the person.
 */
export const personMarks = sqliteTable(
	'person_marks',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		treeId: text('tree_id')
			.notNull()
			.references(() => trees.id, { onDelete: 'cascade' }),
		personId: text('person_id').notNull(),
		kind: text('kind', { enum: ['favorite', 'recent'] }).notNull(),
		/** Epoch milliseconds of the last time the mark was made; recents are listed by it. */
		touchedAt: integer('touched_at').notNull()
	},
	(table) => ({
		uniquePerUser: uniqueIndex('idx_uq_person_mark').on(
			table.userId,
			table.treeId,
			table.kind,
			table.personId
		),
		listIdx: index('idx_person_mark_list').on(
			table.userId,
			table.treeId,
			table.kind,
			table.touchedAt
		)
	})
);
