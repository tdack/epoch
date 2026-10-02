import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { trees } from './trees';

// A place record (ADR-019): an identity for the place a fact's text names. The text on the fact stays
// the authority and `name_key` is derived from it, so a record is found by its text and never
// edited on its own. Records are not deleted when their last fact moves away: an undo then finds
// the same record, and the same id, waiting for it.
export const places = sqliteTable(
	'places',
	{
		id: text('id').primaryKey(),
		treeId: text('tree_id')
			.notNull()
			.references(() => trees.id, { onDelete: 'cascade' }),
		// The place text in ASCII lower case, which is what SQLite's `nocase` and `lower()` both mean.
		nameKey: text('name_key').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
	},
	(table) => ({
		keyIdx: uniqueIndex('idx_place_key').on(table.treeId, table.nameKey)
	})
);

// Events (Births, Deaths, Marriages, Burials, and extensible GEDCOM types)
export const events = sqliteTable(
	'events',
	{
		id: text('id').primaryKey(),
		treeId: text('tree_id')
			.notNull()
			.references(() => trees.id, { onDelete: 'cascade' }),
		entityType: text('entity_type', { enum: ['INDIVIDUAL', 'FAMILY'] }).notNull(),
		entityId: text('entity_id').notNull(),
		// Extensible GEDCOM event tags; stored as text rather than a closed enum so
		// unsupported/custom types survive import/export without loss.
		type: text('type').notNull(),
		dateRaw: text('date_raw'),
		dateSort: text('date_sort'), // inclusive lower bound, YYYY-MM-DD, for indexing
		// ADR-004. Null on rows written before these columns existed; readers fall back to parsing
		// `date_raw`, and scripts/backfill-event-dates.mjs fills them in.
		dateSortEnd: text('date_sort_end'), // inclusive upper bound; null when unbounded
		dateQualifier: text('date_qualifier', {
			enum: [
				'EXACT',
				'ABOUT',
				'ESTIMATED',
				'CALCULATED',
				'BEFORE',
				'AFTER',
				'BETWEEN',
				'FROM_TO',
				'PHRASE',
				'UNKNOWN'
			]
		}),
		datePrecision: text('date_precision', { enum: ['DAY', 'MONTH', 'YEAR', 'NONE'] }),
		dateCalendar: text('date_calendar', {
			enum: ['GREGORIAN', 'JULIAN', 'HEBREW', 'FRENCH_REPUBLICAN', 'UNKNOWN']
		}),
		place: text('place'),
		// The record for `place`, set by the change store and the importer from the text, never by a
		// command, so no writer has it to keep in step (ADR-019). Null when the fact names no place.
		placeId: text('place_id').references(() => places.id, { onDelete: 'set null' }),
		// Written before the fact fields below existed: an imported CAUS, NOTE or line value, which
		// could not be told apart. New facts leave it null and use the specific columns; a fact edited
		// in the editor folds it into `notes` (see fact-commands).
		description: text('description'),
		// The fact editor's fields (Phase 3). Null on every earlier row. `value` is the text on the
		// event's own GEDCOM line (`1 OCCU Carpenter`), `cause` a CAUS, `age` an AGE.
		value: text('value'),
		cause: text('cause'),
		age: text('age'),
		notes: text('notes'),
		// Sub-lines of the fact's GEDCOM structure that the model has no column for (a citation, a second
		// note, a custom tag), verbatim from level 2 down and in file order, so export writes them back
		// inside the same fact. A column rather than gedcom_preserved so they follow the row through
		// edits, a merge and undo, as a name's do (ADR-013). Null when there are none.
		gedcomExtra: text('gedcom_extra', { mode: 'json' }).$type<string[]>(),
		// Manual order among facts that sort together (same date, or both undated). Never a substitute
		// for the date: the timeline is date first.
		sortOrder: integer('sort_order').notNull().default(0),
		version: integer('version').notNull().default(1),
		createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
		updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
	},
	(table) => ({
		entityIdx: index('idx_event_entity').on(table.entityType, table.entityId),
		treeIdx: index('idx_event_tree').on(table.treeId),
		// A place is the text on a fact, grouped and looked up without regard to case (ADR-018); the
		// place page finds its facts by this, and the place list scans it in order.
		placeRecordIdx: index('idx_event_place_id').on(table.placeId),
		placeIdx: index('idx_event_place').on(table.treeId, sql`${table.place} collate nocase`)
	})
);
