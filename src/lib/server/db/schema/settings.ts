import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { users } from './users';

// A person's own colour and motion choices (ADR-053). `data` is a versioned JSON document in which
// each group is optional: a missing group inherits the site default, then the built-in one. The
// document is validated on every write and again on read, so the column never holds a value the
// palette would refuse.
export const userSettings = sqliteTable('user_settings', {
	userId: text('user_id')
		.primaryKey()
		.references(() => users.id, { onDelete: 'cascade' }),
	data: text('data').notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
});

// The install-wide defaults, set by the install owner. One row, enforced by the check: a second
// insert is refused rather than silently becoming a second default.
export const siteSettings = sqliteTable(
	'site_settings',
	{
		id: integer('id').primaryKey(),
		data: text('data').notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
	},
	() => [check('site_settings_singleton', sql`id = 1`)]
);
