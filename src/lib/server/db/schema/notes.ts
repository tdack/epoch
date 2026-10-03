import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { NOTE_SUBJECT_KIND_VALUES } from '../../../shared/notes';
import { trees } from './trees';

/**
 * Notes (ADR-029), on the footing of sources and citations (ADR-028).
 *
 * `notes` are *shared* notes: one root `NOTE`/`SNOTE` record of the file, with an XREF other
 * records point at. `note_attachments` attach a note to one subject, in order: either inline (the
 * text is the attachment's own) or a pointer at a shared note. `gedcom_extra` and `gedcom_layout`
 * work as they do for evidence: the lines with no column, verbatim and in order, and the file's own
 * `CONT`/`CONC` split, used only while it still says the column's text.
 *
 * `created_by` has no foreign key, as for sources: a deleted user must not cascade to notes.
 */

export const notes = sqliteTable(
	'notes',
	{
		id: text('id').primaryKey(),
		treeId: text('tree_id')
			.notNull()
			.references(() => trees.id, { onDelete: 'cascade' }),
		// The file's XREF (`@N1@`), or one Epoch assigned to a note made here. Stable across exports.
		xref: text('xref'),
		// XREFs of notes merged into this one, so a pointer to them still resolves (ADR-008, ADR-022).
		xrefAliases: text('xref_aliases', { mode: 'json' }).$type<string[]>(),
		text: text('text'),
		// GEDCOM 7.0 `MIME` and `LANG` of the note.
		mime: text('mime'),
		language: text('language'),
		// The root tag the file used, `NOTE` or `SNOTE`; null for a note made here.
		gedcomTag: text('gedcom_tag', { enum: ['NOTE', 'SNOTE'] }),
		gedcomExtra: text('gedcom_extra', { mode: 'json' }).$type<string[]>(),
		gedcomLayout: text('gedcom_layout', { mode: 'json' }).$type<Record<string, string[]>>(),
		createdBy: text('created_by'),
		version: integer('version').notNull().default(1),
		createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
		updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
	},
	(table) => ({
		xrefIdx: uniqueIndex('idx_note_xref').on(table.treeId, table.xref),
		// The notes list pages in text order and searches it; `id` ends the key so the order is total.
		textIdx: index('idx_note_text').on(table.treeId, sql`${table.text} collate nocase`, table.id)
	})
);

// One note on one subject. `subject_id` has no foreign key (it points into eight tables); the
// commands that delete or merge a subject move or delete its attachments themselves, in the same
// logged change, so undo restores them.
export const noteAttachments = sqliteTable(
	'note_attachments',
	{
		id: text('id').primaryKey(),
		treeId: text('tree_id')
			.notNull()
			.references(() => trees.id, { onDelete: 'cascade' }),
		subjectKind: text('subject_kind', { enum: NOTE_SUBJECT_KIND_VALUES }).notNull(),
		subjectId: text('subject_id').notNull(),
		sortOrder: integer('sort_order').notNull().default(0),
		// The shared note this points at; null for an inline note and for a pointer at a record the
		// file does not have (`note_ref` keeps that pointer so export writes it back).
		noteId: text('note_id').references(() => notes.id),
		noteRef: text('note_ref'),
		// The tag a pointer was written with (`NOTE` or `SNOTE`); null for an inline note.
		gedcomTag: text('gedcom_tag', { enum: ['NOTE', 'SNOTE'] }),
		// The text of an inline note.
		text: text('text'),
		gedcomExtra: text('gedcom_extra', { mode: 'json' }).$type<string[]>(),
		gedcomLayout: text('gedcom_layout', { mode: 'json' }).$type<Record<string, string[]>>(),
		version: integer('version').notNull().default(1),
		createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
		updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
	},
	(table) => ({
		// Led by the tree, so a record's own notes and a shared note's uses read through these and not
		// through a scan of the tree's attachments, which is what the planner picks for a bare
		// `subject_kind, subject_id` key beside a `tree_id =` test. The tree-wide load (`tree_id =`) is
		// a prefix of both, so no index of the tree alone is kept.
		subjectIdx: index('idx_note_attachment_subject').on(
			table.treeId,
			table.subjectKind,
			table.subjectId,
			table.sortOrder
		),
		noteIdx: index('idx_note_attachment_note').on(table.treeId, table.noteId)
	})
);
