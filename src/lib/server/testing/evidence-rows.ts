/** Hand-built evidence rows for the scoped-snapshot proofs (ADR-055). */

import type {
	CitationRow,
	NoteAttachmentRow,
	NoteRow,
	RepositoryRow,
	ResearchTaskRow,
	SourceRepositoryRow,
	SourceRow
} from '../domain/change-log';
import { TEST_TREE_ID } from './rows';

const T0 = 1_000_000;

export const mkSource = (id: string, o: Partial<SourceRow> = {}): SourceRow => ({
	id,
	treeId: TEST_TREE_ID,
	xref: `@S-${id}@`,
	xrefAliases: null,
	title: `Source ${id}`,
	author: null,
	publication: null,
	abbreviation: null,
	text: null,
	gedcomExtra: null,
	gedcomLayout: null,
	createdBy: null,
	version: 1,
	createdAt: T0,
	updatedAt: T0,
	...o
});

export const mkRepository = (id: string, o: Partial<RepositoryRow> = {}): RepositoryRow => ({
	id,
	treeId: TEST_TREE_ID,
	xref: `@R-${id}@`,
	xrefAliases: null,
	name: `Repository ${id}`,
	address: null,
	gedcomExtra: null,
	gedcomLayout: null,
	createdBy: null,
	version: 1,
	createdAt: T0,
	updatedAt: T0,
	...o
});

export const mkLink = (
	id: string,
	sourceId: string,
	repositoryId: string
): SourceRepositoryRow => ({
	id,
	sourceId,
	repositoryId,
	repositoryRef: null,
	callNumber: `Call ${id}`,
	gedcomExtra: null,
	sortOrder: 0,
	version: 1,
	createdAt: T0,
	updatedAt: T0
});

export const mkNote = (id: string, o: Partial<NoteRow> = {}): NoteRow => ({
	id,
	treeId: TEST_TREE_ID,
	xref: `@N-${id}@`,
	xrefAliases: null,
	text: `Shared note ${id}`,
	mime: null,
	language: null,
	gedcomTag: null,
	gedcomExtra: null,
	gedcomLayout: null,
	createdBy: null,
	version: 1,
	createdAt: T0,
	updatedAt: T0,
	...o
});

export const mkCitation = (
	id: string,
	subjectKind: CitationRow['subjectKind'],
	subjectId: string,
	sourceId: string | null,
	sortOrder = 0
): CitationRow => ({
	id,
	treeId: TEST_TREE_ID,
	subjectKind,
	subjectId,
	sortOrder,
	sourceId,
	sourceRef: null,
	description: null,
	page: `page of ${id}`,
	quality: null,
	entryDateRaw: null,
	entryDateSort: null,
	entryDateSortEnd: null,
	entryDateQualifier: null,
	entryDatePrecision: null,
	entryDateCalendar: null,
	text: null,
	gedcomExtra: null,
	gedcomLayout: null,
	version: 1,
	createdAt: T0,
	updatedAt: T0
});

export const mkAttachment = (
	id: string,
	subjectKind: NoteAttachmentRow['subjectKind'],
	subjectId: string,
	noteId: string | null,
	sortOrder = 0
): NoteAttachmentRow => ({
	id,
	treeId: TEST_TREE_ID,
	subjectKind,
	subjectId,
	sortOrder,
	noteId,
	noteRef: null,
	gedcomTag: null,
	text: noteId ? null : `Inline note ${id}`,
	gedcomExtra: null,
	gedcomLayout: null,
	version: 1,
	createdAt: T0,
	updatedAt: T0
});

export const mkTask = (
	id: string,
	subjectKind: ResearchTaskRow['subjectKind'],
	subjectId: string | null,
	o: Partial<ResearchTaskRow> = {}
): ResearchTaskRow => ({
	id,
	treeId: TEST_TREE_ID,
	title: `Task ${id}`,
	details: null,
	status: 'open',
	assigneeId: null,
	dueDate: null,
	subjectKind,
	subjectId,
	findingKey: null,
	linkClearedKind: null,
	createdBy: null,
	version: 1,
	createdAt: T0,
	updatedAt: T0,
	...o
});
