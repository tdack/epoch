import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { users } from './users';

// Trees
export const trees = sqliteTable(
	'trees',
	{
		id: text('id').primaryKey(),
		name: text('name').notNull(),
		// The tree's readable address, `/trees/<slug>` (ADR-045). Kept when the tree is renamed, so a
		// bookmark survives; null when the name has nothing to make one from, and the id serves.
		slug: text('slug'),
		description: text('description'),
		// ADR-015. A birth this many years ago (its latest upper bound) is what makes a person not living.
		maxAliveYears: integer('max_alive_years').notNull().default(120),
		// Whether viewers see a private person as a "Private" placeholder in the graph and on partnerships;
		// off omits them. Off by default so the safe behaviour needs no action.
		shouldShowPrivateStructure: integer('should_show_private_structure', { mode: 'boolean' })
			.notNull()
			.default(false),
		// The view a member with no setting of their own sees (a `LayoutMode`); null is flat, and a
		// mode since removed reads as null.
		// Set by the owner; changing it does not bump `version`, which guards the name and description.
		defaultViewMode: text('default_view_mode'),
		version: integer('version').notNull().default(1),
		createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
		updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
		// ADR-041. At most one tree in the install is readable without signing in; the partial unique
		// index below makes the database, not the service, refuse a second.
		isPublic: integer('is_public', { mode: 'boolean' }).notNull().default(false),
		publicSince: integer('public_since', { mode: 'timestamp' }),
		// The install owner who made it public. No foreign key: removing a user must not touch the tree.
		publishedBy: text('published_by')
	},
	(table) => ({
		slugIdx: uniqueIndex('idx_trees_slug').on(table.slug),
		onePublicTreeIdx: uniqueIndex('idx_trees_one_public')
			.on(table.isPublic)
			.where(sql`is_public = 1`)
	})
);

// Tree Memberships (Roles: owner, manager, editor, contributor, viewer)
export const treeMemberships = sqliteTable(
	'tree_memberships',
	{
		id: text('id').primaryKey(),
		treeId: text('tree_id')
			.notNull()
			.references(() => trees.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		role: text('role', { enum: ['owner', 'manager', 'editor', 'contributor', 'viewer'] })
			.notNull()
			.default('viewer'),
		// How this member likes the tree drawn (a `LayoutMode`); null means they have not
		// chosen and the tree's default applies (S16 stage 8). Their own setting, so changing it neither
		// bumps `version` (that guards role edits) nor needs a manager.
		viewMode: text('view_mode'),
		// The tree `/` opens for this user. On the membership rather than the user so that leaving or
		// deleting the tree takes the choice with it, instead of leaving a pointer to a tree they lost.
		isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
		// Two managers can change the same member at once; the second sees a conflict, not a silent overwrite.
		version: integer('version').notNull().default(1),
		createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
		updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
	},
	(table) => ({
		treeUserIdx: uniqueIndex('idx_tree_user').on(table.treeId, table.userId),
		userTreeIdx: index('idx_membership_user').on(table.userId),
		oneDefaultIdx: uniqueIndex('idx_membership_one_default')
			.on(table.userId)
			.where(sql`is_default = 1`)
	})
);

// A role offered to an email address, taken up when that address next signs in through Cloudflare
// Access (ADR-016). Access is a separate gate: an invitation here does not let anyone past it.
export const treeInvitations = sqliteTable(
	'tree_invitations',
	{
		id: text('id').primaryKey(),
		treeId: text('tree_id')
			.notNull()
			.references(() => trees.id, { onDelete: 'cascade' }),
		// Lower-cased, so the match with the address Access asserts is exact.
		email: text('email').notNull(),
		role: text('role', { enum: ['owner', 'manager', 'editor', 'contributor', 'viewer'] }).notNull(),
		// The inviter's user id. No foreign key: removing a user must not cascade into the invitations they sent.
		invitedBy: text('invited_by'),
		expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
		createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
	},
	(table) => ({
		// One pending offer per tree and address; inviting again replaces it.
		treeEmailIdx: uniqueIndex('idx_invitation_tree_email').on(table.treeId, table.email),
		// Every authenticated request looks up its own address, so it must not scan.
		emailIdx: index('idx_invitation_email').on(table.email)
	})
);
