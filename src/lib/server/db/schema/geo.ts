import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { places } from './events';
import { trees } from './trees';

// Photon answers kept for good (ADR-078). The key is the normalised query plus the language and
// bias it was asked with; it names no tree or person. There is no expiry: place names change
// slowly and every hit spares the public server. A later stage may add a refresh.
export const geoCache = sqliteTable('geo_cache', {
	key: text('key').primaryKey(),
	// The trimmed candidate list as JSON.
	results: text('results').notNull(),
	createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
});

// Working data for "Match places" (ADR-078): what the geocoder offered for a place, ranked, until a
// reviewer accepts or ignores it. Not a record: it is not in the change log, and each run replaces a
// place's rows. The cascade on `place_id` lets a replace-mode import delete place records.
export const placeMatchCandidates = sqliteTable(
	'place_match_candidates',
	{
		treeId: text('tree_id')
			.notNull()
			.references(() => trees.id, { onDelete: 'cascade' }),
		placeId: text('place_id')
			.notNull()
			.references(() => places.id, { onDelete: 'cascade' }),
		rank: integer('rank').notNull(),
		score: real('score').notNull(),
		latitude: real('latitude').notNull(),
		longitude: real('longitude').notNull(),
		osmType: text('osm_type'),
		osmId: integer('osm_id'),
		displayName: text('display_name').notNull(),
		kind: text('kind'),
		createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
	},
	(table) => ({
		pk: primaryKey({ columns: [table.placeId, table.rank] }),
		treeIdx: index('idx_place_match_candidate_tree').on(table.treeId)
	})
);

// One row per tree: the latest run. The primary key makes "one run at a time" a conditional upsert
// instead of a read followed by a write.
export const placeMatchRuns = sqliteTable('place_match_runs', {
	treeId: text('tree_id')
		.primaryKey()
		.references(() => trees.id, { onDelete: 'cascade' }),
	status: text('status', { enum: ['running', 'done', 'failed'] }).notNull(),
	startedBy: text('started_by'),
	startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
	finishedAt: integer('finished_at', { mode: 'timestamp' }),
	// Places the run chose to look up, how many are done, how many got at least one candidate, and
	// how many more were eligible than the cap allowed.
	totalCount: integer('total_count').notNull().default(0),
	searchedCount: integer('searched_count').notNull().default(0),
	matchedCount: integer('matched_count').notNull().default(0),
	skippedByCapCount: integer('skipped_by_cap_count').notNull().default(0)
});
