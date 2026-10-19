import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { trees } from './trees';

/**
 * A named lens on a tree, rooted at one person (docs/proposal-subtrees.md). Membership is computed
 * from the root (`inSubtree`), never stored. A view over the tree, not genealogy, so it is not
 * exported to GEDCOM; it is in the change log, so deleting one is undoable.
 *
 * `root_person_id` deliberately has no foreign key to `individuals`: person delete is a hard
 * delete that an undo reverses with the same id, and a cascade (or a set-null) would change this
 * row outside the logged ops, so the undo would not bring the sub-tree back. A root that is gone
 * reads as `isRootMissing`, and the sub-tree works again when an undo restores the person.
 */
export const subtrees = sqliteTable(
	'subtree',
	{
		id: text('id').primaryKey(),
		treeId: text('tree_id')
			.notNull()
			.references(() => trees.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		// Valid per `isValidTreeSlug`; unique within the tree.
		slug: text('slug').notNull(),
		rootPersonId: text('root_person_id').notNull(),
		position: integer('position').notNull().default(0),
		// A public visitor of a public tree sees only the sub-trees a manager opted in (ADR-069).
		isPublic: integer('is_public', { mode: 'boolean' }).notNull().default(false),
		version: integer('version').notNull().default(1),
		createdBy: text('created_by'),
		createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
		updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
	},
	(table) => ({
		slugIdx: uniqueIndex('idx_subtree_slug').on(table.treeId, table.slug),
		// A merge or a delete finds the sub-trees rooted at a person.
		rootIdx: index('idx_subtree_root').on(table.treeId, table.rootPersonId)
	})
);
