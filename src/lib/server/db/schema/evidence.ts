import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { CITATION_SUBJECT_KIND_VALUES } from '../../../shared/evidence';
import { trees } from './trees';

/**
 * Sources, repositories and citations (ADR-028).
 *
 * `gedcom_extra` holds the lines of the GEDCOM structure that have no column, verbatim and in
 * order, as for events and names (ADR-013, ADR-023). `gedcom_layout` holds, per text field, the
 * file's own lines for it (a `CONT`/`CONC` split, or an address with sub-tags) so the file comes
 * back as it was; it is used only while it still says the column's text, so an edit simply wins.
 *
 * `created_by` has no foreign key: a deleted user must not cascade to evidence, and imported
 * records have none. It lets a contributor keep seeing what they added before anything cites it.
 */

const DATE_QUALIFIERS = [
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
] as const;

export const sources = sqliteTable(
	'sources',
	{
		id: text('id').primaryKey(),
		treeId: text('tree_id')
			.notNull()
			.references(() => trees.id, { onDelete: 'cascade' }),
		// The file's XREF (`@S1@`), or one Epoch assigned to a source made here. Stable across exports.
		xref: text('xref'),
		// XREFs of sources merged into this one, so a pointer to them still resolves (ADR-008, ADR-022).
		xrefAliases: text('xref_aliases', { mode: 'json' }).$type<string[]>(),
		title: text('title'),
		author: text('author'),
		publication: text('publication'),
		abbreviation: text('abbreviation'),
		text: text('text'),
		gedcomExtra: text('gedcom_extra', { mode: 'json' }).$type<string[]>(),
		gedcomLayout: text('gedcom_layout', { mode: 'json' }).$type<Record<string, string[]>>(),
		createdBy: text('created_by'),
		version: integer('version').notNull().default(1),
		createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
		updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
	},
	(table) => ({
		xrefIdx: uniqueIndex('idx_source_xref').on(table.treeId, table.xref),
		// The sources list pages in title order and searches it; `id` ends the key so the order is total.
		titleIdx: index('idx_source_title').on(
			table.treeId,
			sql`${table.title} collate nocase`,
			table.id
		)
	})
);

export const repositories = sqliteTable(
	'repositories',
	{
		id: text('id').primaryKey(),
		treeId: text('tree_id')
			.notNull()
			.references(() => trees.id, { onDelete: 'cascade' }),
		xref: text('xref'),
		xrefAliases: text('xref_aliases', { mode: 'json' }).$type<string[]>(),
		name: text('name'),
		// The address as text, line breaks kept; GEDCOM's structured parts live in `gedcom_layout`.
		address: text('address'),
		gedcomExtra: text('gedcom_extra', { mode: 'json' }).$type<string[]>(),
		gedcomLayout: text('gedcom_layout', { mode: 'json' }).$type<Record<string, string[]>>(),
		createdBy: text('created_by'),
		version: integer('version').notNull().default(1),
		createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
		updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
	},
	(table) => ({
		xrefIdx: uniqueIndex('idx_repository_xref').on(table.treeId, table.xref),
		nameIdx: index('idx_repository_name').on(table.treeId, sql`${table.name} collate nocase`)
	})
);

// A source's `REPO` links, in order. `repository_id` is null for a `REPO` with no pointer (legal in
// 5.5.1) or whose pointer names a record the file does not have; `repository_ref` keeps that pointer.
export const sourceRepositories = sqliteTable(
	'source_repositories',
	{
		id: text('id').primaryKey(),
		// Denormalised from the parent so ChangeStore can scope writes to the tree. Nullable: rows written
		// by code older than migration 0036 have none until backfilled, and the change store treats a
		// null as "own row" so they stay editable. Not part of the logged row image (see PersonNameRow).
		treeId: text('tree_id').references(() => trees.id, { onDelete: 'cascade' }),
		sourceId: text('source_id')
			.notNull()
			.references(() => sources.id, { onDelete: 'cascade' }),
		repositoryId: text('repository_id').references(() => repositories.id, {
			onDelete: 'cascade'
		}),
		repositoryRef: text('repository_ref'),
		callNumber: text('call_number'),
		// Everything else under the `REPO` link (`MEDI`, a note, a custom tag), verbatim and in order.
		gedcomExtra: text('gedcom_extra', { mode: 'json' }).$type<string[]>(),
		sortOrder: integer('sort_order').notNull().default(0),
		version: integer('version').notNull().default(1),
		createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
		updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
	},
	(table) => ({
		sourceIdx: index('idx_source_repository_source').on(table.sourceId),
		repositoryIdx: index('idx_source_repository_repository').on(table.repositoryId)
	})
);

// One GEDCOM `SOUR` substructure in one place. Owned by exactly one subject, so editing, moving
// or deleting it never touches another claim. `subject_id` has no foreign key (it points into five
// tables); the commands that delete or merge a subject move or delete its citations themselves, in
// the same logged change, so undo restores them.
export const citations = sqliteTable(
	'citations',
	{
		id: text('id').primaryKey(),
		treeId: text('tree_id')
			.notNull()
			.references(() => trees.id, { onDelete: 'cascade' }),
		subjectKind: text('subject_kind', { enum: CITATION_SUBJECT_KIND_VALUES }).notNull(),
		subjectId: text('subject_id').notNull(),
		sortOrder: integer('sort_order').notNull().default(0),
		// Null for a citation with no pointer (5.5.1 allows inline text) or one of a record the file
		// does not have; `source_ref` keeps that pointer so export writes it back.
		sourceId: text('source_id').references(() => sources.id),
		sourceRef: text('source_ref'),
		// The inline text of a citation that has no pointer.
		description: text('description'),
		page: text('page'),
		// GEDCOM `QUAY`, 0 to 3.
		quality: integer('quality'),
		// `DATA.DATE`: when the source recorded it, in the same columns as an event's date (ADR-004).
		entryDateRaw: text('entry_date_raw'),
		entryDateSort: text('entry_date_sort'),
		entryDateSortEnd: text('entry_date_sort_end'),
		entryDateQualifier: text('entry_date_qualifier', { enum: DATE_QUALIFIERS }),
		entryDatePrecision: text('entry_date_precision', { enum: ['DAY', 'MONTH', 'YEAR', 'NONE'] }),
		entryDateCalendar: text('entry_date_calendar', {
			enum: ['GREGORIAN', 'JULIAN', 'HEBREW', 'FRENCH_REPUBLICAN', 'UNKNOWN']
		}),
		// `DATA.TEXT`: the words of the source.
		text: text('text'),
		gedcomExtra: text('gedcom_extra', { mode: 'json' }).$type<string[]>(),
		gedcomLayout: text('gedcom_layout', { mode: 'json' }).$type<Record<string, string[]>>(),
		version: integer('version').notNull().default(1),
		createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
		updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
	},
	(table) => ({
		subjectIdx: index('idx_citation_subject').on(
			table.subjectKind,
			table.subjectId,
			table.sortOrder
		),
		sourceIdx: index('idx_citation_source').on(table.sourceId),
		treeIdx: index('idx_citation_tree').on(table.treeId)
	})
);
