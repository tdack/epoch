import { CITATION_SUBJECT_KINDS, type CitationSubjectRef } from '../../../shared/evidence';
import { NOTE_SUBJECT_KINDS, type NoteSubjectRef } from '../../../shared/notes';
import { TASK_SUBJECT_KINDS, type TaskSubjectRef } from '../../../shared/tasks';
import type { TreeRows } from '../change-log';
import { seedOf, type ScopeSeed } from '../write-scope';
import type { ScopeTable } from './types';

/**
 * A source is seeded directly wherever a command has to find it. To a restricted viewer a source
 * exists only while some citation of it sits on a record they may see, and the planners first plan
 * over the viewer's rows, so "hidden" and "present" can only be told apart if every citation of the
 * source is loaded. A source reached merely through one citation does not bring the others; a
 * seeded one does.
 */
const sourceSeed = (sourceId: string | null | undefined) => seedOf({ sources: [sourceId] });

const EVERY_TABLE: ReadonlyArray<keyof TreeRows> = [
	'individuals',
	'personNames',
	'unions',
	'unionPartners',
	'parentChild',
	'events',
	'mediaItems',
	'sources',
	'repositories',
	'sourceRepositories',
	'citations',
	'notes',
	'noteAttachments',
	'researchTasks'
];

/**
 * A seed that is the whole tree, for the one variant of a kind that cannot be scoped while the
 * other variants can. A repository exists for a restricted viewer only through the sources that
 * link it, and a shared note only through the records that use it, none of which the closure
 * reaches from the repository or the note.
 */
const WHOLE_TREE: ScopeSeed = seedOf({ wholeTables: EVERY_TABLE });

function citationSubjectSeed(subject: CitationSubjectRef): ScopeSeed {
	switch (subject.kind) {
		case CITATION_SUBJECT_KINDS.PERSON:
			return seedOf({ people: [subject.id] });
		case CITATION_SUBJECT_KINDS.NAME:
			return seedOf({ names: [subject.id] });
		case CITATION_SUBJECT_KINDS.EVENT:
			return seedOf({ events: [subject.id] });
		case CITATION_SUBJECT_KINDS.UNION:
			return seedOf({ unions: [subject.id] });
		case CITATION_SUBJECT_KINDS.PARENT_CHILD:
			return seedOf({ links: [subject.id] });
	}
}

function noteSubjectSeed(subject: NoteSubjectRef): ScopeSeed {
	switch (subject.kind) {
		case NOTE_SUBJECT_KINDS.PERSON:
			return seedOf({ people: [subject.id] });
		case NOTE_SUBJECT_KINDS.NAME:
			return seedOf({ names: [subject.id] });
		case NOTE_SUBJECT_KINDS.EVENT:
			return seedOf({ events: [subject.id] });
		case NOTE_SUBJECT_KINDS.UNION:
			return seedOf({ unions: [subject.id] });
		case NOTE_SUBJECT_KINDS.PARENT_CHILD:
			return seedOf({ links: [subject.id] });
		case NOTE_SUBJECT_KINDS.SOURCE:
			return sourceSeed(subject.id);
		case NOTE_SUBJECT_KINDS.CITATION:
			return seedOf({ citations: [subject.id] });
		case NOTE_SUBJECT_KINDS.REPOSITORY:
			return WHOLE_TREE;
	}
}

function taskSubjectSeed(subject: TaskSubjectRef | null | undefined): ScopeSeed {
	if (!subject) return seedOf({});
	switch (subject.kind) {
		case TASK_SUBJECT_KINDS.PERSON:
			return seedOf({ people: [subject.id] });
		case TASK_SUBJECT_KINDS.UNION:
			return seedOf({ unions: [subject.id] });
		case TASK_SUBJECT_KINDS.EVENT:
			return seedOf({ events: [subject.id] });
		case TASK_SUBJECT_KINDS.SOURCE:
			return sourceSeed(subject.id);
		case TASK_SUBJECT_KINDS.NOTE:
			return WHOLE_TREE;
	}
}

/**
 * Seeds for sources, repositories, citations, notes and tasks. A kind with no entry loads the
 * whole tree. Left out on purpose:
 *
 * - `merge_sources`, `merge_notes`: whole-tree by ADR-055.
 * - Anything that must find a repository or a source link by id (`update_repository`,
 *   `delete_repository`, `link_repository`, `update_source_repository`, `unlink_repository`): a
 *   repository exists for a restricted viewer only through the sources that link it, and those
 *   are not reachable from the repository (a link id cannot even be named in a seed).
 * - Anything keyed by an attachment, note or task id alone (`update_note`, `remove_note`,
 *   `share_note`, `attach_note`, `update_shared_note`, `delete_shared_note`, `update_task`,
 *   `delete_task`): the id does not say whether the note sits on a source or repository, or the
 *   task is about a source or a note, and then what a restricted viewer sees depends on records
 *   the closure does not load. `evidence.test.ts` shows each failing.
 */
export const EVIDENCE_SCOPES: ScopeTable = {
	// A new record's XREF must not collide with one already taken, so that whole table is read.
	create_source: () => seedOf({ wholeTables: ['sources'] }),
	update_source: (c) => sourceSeed(c.sourceId),
	delete_source: (c) => sourceSeed(c.sourceId),
	create_repository: () => seedOf({ wholeTables: ['repositories'] }),
	add_citation: (c) => ({
		...citationSubjectSeed(c.subject),
		sources: sourceSeed(c.citation.sourceId).sources
	}),
	update_citation: (c) => ({
		...seedOf({ citations: [c.citationId] }),
		sources: sourceSeed(c.citation.sourceId).sources
	}),
	remove_citation: (c) => seedOf({ citations: [c.citationId] }),
	// The subject brings every citation on it, which is every sibling to reorder.
	reorder_citations: (c) => citationSubjectSeed(c.subject),
	add_note: (c) => noteSubjectSeed(c.subject),
	reorder_notes: (c) => noteSubjectSeed(c.subject),
	create_note: () => seedOf({ wholeTables: ['notes'] })
};
