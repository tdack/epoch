import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

// Users (authenticated via Cloudflare Access)
export const users = sqliteTable(
	'users',
	{
		id: text('id').primaryKey(), // internal UUID
		accessSub: text('access_sub').notNull().unique(), // Cloudflare Access stable 'sub'
		email: text('email').notNull(),
		name: text('name'),
		createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
		updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
	},
	(table) => ({
		accessSubIdx: uniqueIndex('idx_users_access_sub').on(table.accessSub),
		emailIdx: index('idx_users_email').on(table.email)
	})
);
