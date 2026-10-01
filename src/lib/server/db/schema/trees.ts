import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { users } from './users';

// Trees
export const trees = sqliteTable('trees', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  // ADR-015. A birth this many years ago (its latest upper bound) is what makes a person not living.
  maxAliveYears: integer('max_alive_years').notNull().default(120),
  // Whether viewers see a private person as a "Private" placeholder in the graph and on partnerships;
  // off omits them. Off by default so the safe behaviour needs no action.
  shouldShowPrivateStructure: integer('should_show_private_structure', { mode: 'boolean' }).notNull().default(false),
  version: integer('version').notNull().default(1),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
});

// Tree Memberships (Roles: owner, manager, editor, contributor, viewer)
export const treeMemberships = sqliteTable('tree_memberships', {
  id: text('id').primaryKey(),
  treeId: text('tree_id').notNull().references(() => trees.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['owner', 'manager', 'editor', 'contributor', 'viewer'] }).notNull().default('viewer'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
}, (table) => ({
  treeUserIdx: uniqueIndex('idx_tree_user').on(table.treeId, table.userId),
  userTreeIdx: index('idx_membership_user').on(table.userId)
}));
