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
  // Two managers can change the same member at once; the second sees a conflict, not a silent overwrite.
  version: integer('version').notNull().default(1),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
}, (table) => ({
  treeUserIdx: uniqueIndex('idx_tree_user').on(table.treeId, table.userId),
  userTreeIdx: index('idx_membership_user').on(table.userId)
}));

// A role offered to an email address, taken up when that address next signs in through Cloudflare
// Access (ADR-016). Access is a separate gate: an invitation here does not let anyone past it.
export const treeInvitations = sqliteTable('tree_invitations', {
  id: text('id').primaryKey(),
  treeId: text('tree_id').notNull().references(() => trees.id, { onDelete: 'cascade' }),
  // Lower-cased, so the match with the address Access asserts is exact.
  email: text('email').notNull(),
  role: text('role', { enum: ['owner', 'manager', 'editor', 'contributor', 'viewer'] }).notNull(),
  // The inviter's user id. No foreign key: removing a user must not cascade into the invitations they sent.
  invitedBy: text('invited_by'),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
}, (table) => ({
  // One pending offer per tree and address; inviting again replaces it.
  treeEmailIdx: uniqueIndex('idx_invitation_tree_email').on(table.treeId, table.email),
  // Every authenticated request looks up its own address, so it must not scan.
  emailIdx: index('idx_invitation_email').on(table.email)
}));
