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
		// The fact details the editor shows (migration 0031). Each is null on every earlier row, and an
		// import writes null where the file had nothing, so a fact without one reads the same as before.
		// `address` is the ADDR's logical text (its value joined with CONT lines, CONC joined directly),
		// stored untrimmed: trimming would lose a trailing space the file wrote, and the export must give
		// it back. `addressLayout` is the file's own ADDR lines (ADDR, CONT, CONC, ADR1..CTRY) as
		// JSON, so the export writes the same structure. It is only used while it still produces
		// `address`; an edit that changes the text makes it stale and it is dropped on the next write.
		address: text('address'),
		addressLayout: text('address_layout', { mode: 'json' }).$type<string[]>(),
		// The fact's TYPE line (`2 TYPE Military`), the sub-type of an EVEN or FACT.
		classification: text('classification'),
		// AGNC: the agency or institution that handled the fact.
		agency: text('agency'),
		// PHON, EMAIL, FAX and WWW can each repeat (the spec allows three). Every value is joined with
		// `\n` in file order: a value is single-line, so the newline is never part of one.
		phone: text('phone'),
		email: text('email'),
		fax: text('fax'),
		web: text('web'),
		// MAP > LATI and LONG, kept exactly as the file wrote them (`N18.150944`), not converted to a
		// number: a conversion would change the text on export, and the hemisphere letter is part of
		// the value.
		latitude: text('latitude'),
		longitude: text('longitude'),
		// The PLAC's own sub-lines other than MAP (FORM, FONE, ROMN, NOTE, SOUR, and anything custom),
		// verbatim from level 3 and in file order. They sit with the place text, so they stay in place
		// on export and do not leave the fact with nowhere to go. JSON, as gedcom_extra is.
		placeExtra: text('place_extra', { mode: 'json' }).$type<string[]>(),
		// The same for the sub-lines of DATE (a TIME), CAUS (a CONT) and AGE (a PHRASE): the model keeps
		// the value, these keep what hangs under it. Each goes stale when its own value is edited.
		dateExtra: text('date_extra', { mode: 'json' }).$type<string[]>(),
		causeExtra: text('cause_extra', { mode: 'json' }).$type<string[]>(),
		ageExtra: text('age_extra', { mode: 'json' }).$type<string[]>(),
		// RELI: the religion of a fact (a christening or burial record).
		religion: text('religion'),
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
		// Only the facts whose kept lines hold an association, so the person page finds the ones naming
		// a person without reading every fact of the tree. A query uses it only by repeating the term.
		assoIdx: index('idx_event_asso')
			.on(table.treeId)
			.where(sql`instr(gedcom_extra, 'ASSO @') > 0`),
		// A place is the text on a fact, grouped and looked up without regard to case (ADR-018); the
		// place page finds its facts by this, and the place list scans it in order.
		placeRecordIdx: index('idx_event_place_id').on(table.placeId),
		placeIdx: index('idx_event_place').on(table.treeId, sql`${table.place} collate nocase`)
	})
);
