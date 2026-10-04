/**
 * The vocabulary of notes (ADR-029), shared by the server and the screens so a subject kind or a
 * note's wording has one spelling.
 *
 * A note is either *inline* (text owned by exactly one subject, in order, like a citation) or
 * *shared* (a record with an XREF that many subjects point at). Both are attached to a subject by
 * one attachment row; an inline attachment holds the text, a shared one points at the record.
 */

/** What a note can be attached to. A note under anything not listed stays retained as lines. */
export const NOTE_SUBJECT_KINDS = {
	PERSON: 'person',
	NAME: 'name',
	EVENT: 'event',
	UNION: 'union',
	PARENT_CHILD: 'parent_child',
	SOURCE: 'source',
	CITATION: 'citation',
	REPOSITORY: 'repository'
} as const;
export type NoteSubjectKind = (typeof NOTE_SUBJECT_KINDS)[keyof typeof NOTE_SUBJECT_KINDS];

export const NOTE_SUBJECT_KIND_VALUES = [
	NOTE_SUBJECT_KINDS.PERSON,
	NOTE_SUBJECT_KINDS.NAME,
	NOTE_SUBJECT_KINDS.EVENT,
	NOTE_SUBJECT_KINDS.UNION,
	NOTE_SUBJECT_KINDS.PARENT_CHILD,
	NOTE_SUBJECT_KINDS.SOURCE,
	NOTE_SUBJECT_KINDS.CITATION,
	NOTE_SUBJECT_KINDS.REPOSITORY
] as const;

export interface NoteSubjectRef {
	kind: NoteSubjectKind;
	id: string;
}

/**
 * The root tag a shared note was written with. 5.5.1 has `NOTE` records and 7.0 has `SNOTE`; both
 * read into the same record, and the tag is kept so a record that came from a 5.5.1 file is written
 * back the way it was (ADR-029).
 */
export const NOTE_RECORD_TAGS = { NOTE: 'NOTE', SNOTE: 'SNOTE' } as const;
export type NoteRecordTag = (typeof NOTE_RECORD_TAGS)[keyof typeof NOTE_RECORD_TAGS];

/** The most a note list pages in one response. */
export const MAX_NOTE_PAGE_SIZE = 100;
export const DEFAULT_NOTE_PAGE_SIZE = 25;

/**
 * The most rows one note change writes, for the same reason as `MAX_EVIDENCE_OPS`: each row costs
 * a version guard, a write and a log record against D1's per-invocation query limit.
 */
export const MAX_NOTE_OPS = 300;

/** The fields a shared note is made and edited with. A missing field on an edit is left as it is. */
export interface SharedNoteInput {
	text?: string | null;
	/** GEDCOM 7.0 `MIME`, such as `text/plain` or `text/html`. */
	mime?: string | null;
	/** GEDCOM 7.0 `LANG`, a BCP 47 tag such as `en-AU`. */
	language?: string | null;
}

/** The first line of a note's text, shortened: what a list or a link says about it. */
export function noteTitle(text: string | null, max = 80): string {
	const first = (text ?? '').split('\n').find((line) => line.trim()) ?? '';
	if (!first) return 'Empty note';
	return first.length > max ? `${first.slice(0, max - 1)}…` : first;
}

// ---- What the pages read ----

/** One note attached to a record, inline or shared, as the pages show it. */
export interface NoteDto {
	/** The attachment's id: what reordering, editing an inline note and detaching address. */
	id: string;
	/** Send this back when editing; a newer stored version is a conflict. */
	version: number;
	sortOrder: number;
	subject: NoteSubjectRef;
	/** Null for an inline note. */
	noteId: string | null;
	/** The shared note's version, for editing it from here. */
	noteVersion: number | null;
	/** The note's words. Empty for a shared note the viewer may not see (never sent). */
	text: string;
	/** True when the note is a shared record that other records use too. */
	isShared: boolean;
	/** True for a pointer at a note record the file did not have: shown, never editable. */
	isMissing: boolean;
	/** For a shared note: how many records the viewer can see using it, this one included. */
	usedBy: number;
	mime: string | null;
	language: string | null;
}

/** A shared note in the list. */
export interface NoteListItem {
	id: string;
	xref: string | null;
	/** The first line, shortened. */
	title: string;
	/** Records the viewer can see using the note. */
	useCount: number;
}

/** A record that uses a shared note, for the note's page. */
export interface NoteUse {
	attachmentId: string;
	subject: NoteSubjectRef;
	/** "Ann Ash", "the birth of Ann Ash", "the partnership of Ann Ash and Bob Ash", "Parish register". */
	label: string;
	personId: string | null;
	unionId: string | null;
	sourceId: string | null;
}

export interface SharedNoteDto {
	id: string;
	xref: string | null;
	version: number;
	text: string;
	mime: string | null;
	language: string | null;
	/** Records the viewer can see using the note, all pages. */
	useCount: number;
	uses: NoteUse[];
	hasMore: boolean;
	offset: number;
	limit: number;
}
