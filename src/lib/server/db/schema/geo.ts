import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Photon answers kept for good (ADR-078). The key is the normalised query plus the language and
// bias it was asked with; it names no tree or person. There is no expiry: place names change
// slowly and every hit spares the public server. A later stage may add a refresh.
export const geoCache = sqliteTable('geo_cache', {
	key: text('key').primaryKey(),
	// The trimmed candidate list as JSON.
	results: text('results').notNull(),
	createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
});
