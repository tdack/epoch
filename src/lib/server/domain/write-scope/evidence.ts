import { CITATION_SUBJECT_KINDS, type CitationSubjectRef } from '../../../shared/evidence';
import { NOTE_SUBJECT_KINDS, type NoteSubjectRef } from '../../../shared/notes';
import { TASK_SUBJECT_KINDS, type TaskSubjectRef } from '../../../shared/tasks';
import { mergeSeeds, seedOf, type ScopeSeed } from '../write-scope';
import type { ScopeTable } from './types';

/**
 * A source is seeded directly wherever a command has to find it. To a restricted viewer a source
 * exists only while some citation of it sits on a record they may see, and the planners first plan
 * over the viewer's rows, so "hidden" and "present" can only be told apart if every citation of the
 * source is loaded. A source reached merely through one citation does not bring the others; a
 * seeded one does. A caller who sees everything needs only the row, so a source with thousands of
 * citations costs one read to edit or cite.
 */
const sourceSeed = (sourceId: string | null | undefined, isRestricted: boolean) =>
	seedOf(isRestricted ? { sources: [sourceId] } : { bareSources: [sourceId] });

/**
 * The follow-up is on wherever a command reads the row of the record it is about: a partnership
 * with no partners (or the fact or link of one) is hidden from a restricted viewer by the whole
 * tree's mask only when somebody in it is private, which a scoped snapshot of it does not show, so
 * the follow-up falls back to the whole tree for it (`seedWithFollowUp`).
 */
const following = (ids: Parameters<typeof seedOf>[0]) =>
	seedOf({ ...ids, shouldFollowEvidence: true });

function citationSubjectSeed(subject: CitationSubjectRef): ScopeSeed {
	switch (subject.kind) {
		case CITATION_SUBJECT_KINDS.PERSON:
			return following({ people: [subject.id] });
		case CITATION_SUBJECT_KINDS.NAME:
			return following({ names: [subject.id] });
		case CITATION_SUBJECT_KINDS.EVENT:
			return following({ events: [subject.id] });
		case CITATION_SUBJECT_KINDS.UNION:
			return following({ unions: [subject.id] });
		case CITATION_SUBJECT_KINDS.PARENT_CHILD:
			return following({ links: [subject.id] });
	}
}

function noteSubjectSeed(subject: NoteSubjectRef): ScopeSeed {
	switch (subject.kind) {
		case NOTE_SUBJECT_KINDS.PERSON:
			return following({ people: [subject.id] });
		case NOTE_SUBJECT_KINDS.NAME:
			return following({ names: [subject.id] });
		case NOTE_SUBJECT_KINDS.EVENT:
			return following({ events: [subject.id] });
		case NOTE_SUBJECT_KINDS.UNION:
			return following({ unions: [subject.id] });
		case NOTE_SUBJECT_KINDS.PARENT_CHILD:
			return following({ links: [subject.id] });
		case NOTE_SUBJECT_KINDS.SOURCE:
			return following({ sources: [subject.id] });
		case NOTE_SUBJECT_KINDS.CITATION:
			return following({ citations: [subject.id] });
		case NOTE_SUBJECT_KINDS.REPOSITORY:
			return following({ repositories: [subject.id] });
	}
}

function taskSubjectSeed(subject: TaskSubjectRef | null | undefined): ScopeSeed {
	if (!subject) return seedOf({});
	switch (subject.kind) {
		case TASK_SUBJECT_KINDS.PERSON:
			return following({ people: [subject.id] });
		case TASK_SUBJECT_KINDS.UNION:
			return following({ unions: [subject.id] });
		case TASK_SUBJECT_KINDS.EVENT:
			return following({ events: [subject.id] });
		case TASK_SUBJECT_KINDS.SOURCE:
			return following({ sources: [subject.id] });
		case TASK_SUBJECT_KINDS.NOTE:
			return following({ notes: [subject.id] });
	}
}

/**
 * Seeds for sources, repositories, citations, notes and tasks. A kind with no entry loads the
 * whole tree; the only ones left are `merge_sources` and `merge_notes`, whole-tree by ADR-055
 * because they read every use of the records they fold.
 *
 * What a restricted viewer sees of a note, a task, a source or a repository depends on records that
 * no seed can name: the attachment, note or task id does not say what the note sits on or what the
 * task is about, and a repository is visible only through the sources that link it. Those kinds
 * opt in to the evidence follow-up (`write-scope/follow-up.ts`), which finds them in the first
 * snapshot and loads them next.
 */
export const EVIDENCE_SCOPES: ScopeTable = {
	// A new record's XREF must not collide with one already taken, so that whole table is read.
	create_source: () => seedOf({ wholeTables: ['sources'] }),
	update_source: (c, isRestricted) => sourceSeed(c.sourceId, isRestricted),
	// Deleting reads every citation and file of the source, whoever asks.
	delete_source: (c) => sourceSeed(c.sourceId, true),
	create_repository: () => seedOf({ wholeTables: ['repositories'] }),
	// A repository is visible to a restricted viewer only through a visible source that links it, so
	// the follow-up loads the sources its links name, and with them the citations that decide.
	update_repository: (c) => following({ repositories: [c.repositoryId] }),
	delete_repository: (c) => following({ repositories: [c.repositoryId] }),
	link_repository: (c) => following({ sources: [c.sourceId], repositories: [c.repositoryId] }),
	update_source_repository: (c) => following({ sourceRepositories: [c.linkId] }),
	unlink_repository: (c) => following({ sourceRepositories: [c.linkId] }),
	add_citation: (c, isRestricted) =>
		mergeSeeds(citationSubjectSeed(c.subject), sourceSeed(c.citation.sourceId, isRestricted)),
	update_citation: (c, isRestricted) =>
		mergeSeeds(
			seedOf({ citations: [c.citationId] }),
			sourceSeed(c.citation.sourceId, isRestricted)
		),
	remove_citation: (c) => seedOf({ citations: [c.citationId] }),
	// The subject brings every citation on it, which is every sibling to reorder.
	reorder_citations: (c) => citationSubjectSeed(c.subject),
	add_note: (c) => noteSubjectSeed(c.subject),
	reorder_notes: (c) => noteSubjectSeed(c.subject),
	create_note: () => seedOf({ wholeTables: ['notes'] }),
	// An attachment is visible to a restricted viewer only if what it sits on is, and a shared note
	// only through the attachments that use it, so the follow-up seeds the source or repository an
	// attachment is on (and the repository's sources), which loads the citations that decide.
	update_note: (c) => following({ noteAttachments: [c.attachmentId] }),
	remove_note: (c) => following({ noteAttachments: [c.attachmentId] }),
	// The new note's XREF is picked among every note's, as for `create_note`.
	share_note: (c) => following({ noteAttachments: [c.attachmentId], wholeTables: ['notes'] }),
	attach_note: (c) => mergeSeeds(noteSubjectSeed(c.subject), following({ notes: [c.noteId] })),
	update_shared_note: (c) => following({ notes: [c.noteId] }),
	delete_shared_note: (c) => following({ notes: [c.noteId] }),
	create_task: (c) => taskSubjectSeed(c.subject),
	// A task is visible to a restricted viewer only if the source or note it is about is, so the
	// follow-up seeds that source (its citations decide) or note (its attachments decide).
	update_task: (c) => following({ tasks: [c.taskId] }),
	delete_task: (c) => following({ tasks: [c.taskId] })
};
