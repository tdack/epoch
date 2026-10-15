/**
 * The ranked, batched reads a scoped write snapshot needs beyond the graph window's own
 * (ADR-055): records by id, evidence and notes by what they are about, and a partnership's partners
 * reached from one of them. Like the graph window's, every read is scoped to the tree, chunks its
 * ids under D1's parameter cap, and returns images tagged with `rowid` so the caller can restore
 * insertion order.
 */

import { and, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import {
	citations,
	events,
	individuals,
	mediaItems,
	noteAttachments,
	notes,
	parentChild,
	personNames,
	repositories,
	researchTasks,
	sourceRepositories,
	sources,
	unionPartners,
	unions
} from '../db/schema';
import type {
	CitationRow,
	EventRow,
	MediaRow,
	NoteAttachmentRow,
	NoteRow,
	ParentChildRow,
	PersonNameRow,
	RepositoryRow,
	ResearchTaskRow,
	SourceRepositoryRow,
	SourceRow,
	UnionPartnerRow
} from '../domain/change-log';
import { GraphWindowRepository, inTree, type Ranked, type Read } from './graph-window-repository';

type Reads<T> = Read<Array<Ranked<T>>>;

export class ScopedReads extends GraphWindowRepository {
	/**
	 * Every partner row of every partnership these people are in: their own rows and their
	 * partners', in one query, so a person's partners are known a round earlier than asking for the
	 * person's rows and then the partnerships'.
	 */
	coPartnerRows(treeId: string, personIds: readonly string[]): Reads<UnionPartnerRow> {
		const mine = alias(unionPartners, 'mine');
		return this.readIn(unionPartners, personIds, (chunk) =>
			this.client
				.select({ ...getTableColumns(unionPartners), rid: sql<number>`${unionPartners}.rowid` })
				.from(unionPartners)
				.innerJoin(mine, eq(mine.unionId, unionPartners.unionId))
				.innerJoin(unions, eq(unions.id, unionPartners.unionId))
				.where(and(inTree(unions.treeId, treeId), inArray(mine.personId, chunk)))
		);
	}

	eventsIn(treeId: string, ids: readonly string[]): Reads<EventRow> {
		return this.readIn(events, ids, (chunk) =>
			this.client
				.select({ ...getTableColumns(events), rid: sql<number>`${events}.rowid` })
				.from(events)
				.where(and(inTree(events.treeId, treeId), inArray(events.id, chunk)))
		);
	}

	namesIn(treeId: string, ids: readonly string[]): Reads<PersonNameRow> {
		return this.readIn(personNames, ids, (chunk) =>
			this.client
				.select({ ...getTableColumns(personNames), rid: sql<number>`${personNames}.rowid` })
				.from(personNames)
				.innerJoin(individuals, eq(individuals.id, personNames.personId))
				.where(and(inTree(individuals.treeId, treeId), inArray(personNames.id, chunk)))
		);
	}

	linksIn(treeId: string, ids: readonly string[]): Reads<ParentChildRow> {
		return this.readIn(parentChild, ids, (chunk) =>
			this.client
				.select({ ...getTableColumns(parentChild), rid: sql<number>`${parentChild}.rowid` })
				.from(parentChild)
				.where(and(inTree(parentChild.treeId, treeId), inArray(parentChild.id, chunk)))
		);
	}

	mediaIn(treeId: string, ids: readonly string[]): Reads<MediaRow> {
		return this.readIn(mediaItems, ids, (chunk) =>
			this.client
				.select({ ...getTableColumns(mediaItems), rid: sql<number>`${mediaItems}.rowid` })
				.from(mediaItems)
				.where(and(inTree(mediaItems.treeId, treeId), inArray(mediaItems.id, chunk)))
		);
	}

	citationsIn(treeId: string, ids: readonly string[]): Reads<CitationRow> {
		return this.readIn(citations, ids, (chunk) =>
			this.client
				.select({ ...getTableColumns(citations), rid: sql<number>`${citations}.rowid` })
				.from(citations)
				.where(and(inTree(citations.treeId, treeId), inArray(citations.id, chunk)))
		);
	}

	/** Citations of one kind of subject: the `(subject_kind, subject_id)` index leads. */
	citationsBySubject(
		treeId: string,
		kind: CitationRow['subjectKind'],
		subjectIds: readonly string[]
	): Reads<CitationRow> {
		return this.readIn(citations, subjectIds, (chunk) =>
			this.client
				.select({ ...getTableColumns(citations), rid: sql<number>`${citations}.rowid` })
				.from(citations)
				.where(
					and(
						inTree(citations.treeId, treeId),
						eq(citations.subjectKind, kind),
						inArray(citations.subjectId, chunk)
					)
				)
		);
	}

	citationsOfSources(treeId: string, sourceIds: readonly string[]): Reads<CitationRow> {
		return this.readIn(citations, sourceIds, (chunk) =>
			this.client
				.select({ ...getTableColumns(citations), rid: sql<number>`${citations}.rowid` })
				.from(citations)
				.where(and(inTree(citations.treeId, treeId), inArray(citations.sourceId, chunk)))
		);
	}

	sourcesIn(treeId: string, ids: readonly string[]): Reads<SourceRow> {
		return this.readIn(sources, ids, (chunk) =>
			this.client
				.select({ ...getTableColumns(sources), rid: sql<number>`${sources}.rowid` })
				.from(sources)
				.where(and(inTree(sources.treeId, treeId), inArray(sources.id, chunk)))
		);
	}

	repositoriesIn(treeId: string, ids: readonly string[]): Reads<RepositoryRow> {
		return this.readIn(repositories, ids, (chunk) =>
			this.client
				.select({ ...getTableColumns(repositories), rid: sql<number>`${repositories}.rowid` })
				.from(repositories)
				.where(and(inTree(repositories.treeId, treeId), inArray(repositories.id, chunk)))
		);
	}

	/** A source's repository links; `source_repositories` has no tree column, so the source tests it. */
	sourceRepositoriesOfSources(
		treeId: string,
		sourceIds: readonly string[]
	): Reads<SourceRepositoryRow> {
		return this.readIn(sourceRepositories, sourceIds, (chunk) =>
			this.client
				.select({
					...getTableColumns(sourceRepositories),
					rid: sql<number>`${sourceRepositories}.rowid`
				})
				.from(sourceRepositories)
				.innerJoin(sources, eq(sources.id, sourceRepositories.sourceId))
				.where(and(inTree(sources.treeId, treeId), inArray(sourceRepositories.sourceId, chunk)))
		);
	}

	/** A repository's links, tested through the repository for the same reason. */
	sourceRepositoriesOfRepositories(
		treeId: string,
		repositoryIds: readonly string[]
	): Reads<SourceRepositoryRow> {
		return this.readIn(sourceRepositories, repositoryIds, (chunk) =>
			this.client
				.select({
					...getTableColumns(sourceRepositories),
					rid: sql<number>`${sourceRepositories}.rowid`
				})
				.from(sourceRepositories)
				.innerJoin(repositories, eq(repositories.id, sourceRepositories.repositoryId))
				.where(
					and(inTree(repositories.treeId, treeId), inArray(sourceRepositories.repositoryId, chunk))
				)
		);
	}

	notesIn(treeId: string, ids: readonly string[]): Reads<NoteRow> {
		return this.readIn(notes, ids, (chunk) =>
			this.client
				.select({ ...getTableColumns(notes), rid: sql<number>`${notes}.rowid` })
				.from(notes)
				.where(and(inTree(notes.treeId, treeId), inArray(notes.id, chunk)))
		);
	}

	attachmentsIn(treeId: string, ids: readonly string[]): Reads<NoteAttachmentRow> {
		return this.readIn(noteAttachments, ids, (chunk) =>
			this.client
				.select({
					...getTableColumns(noteAttachments),
					rid: sql<number>`${noteAttachments}.rowid`
				})
				.from(noteAttachments)
				.where(and(inTree(noteAttachments.treeId, treeId), inArray(noteAttachments.id, chunk)))
		);
	}

	/**
	 * Note attachments on one kind of subject. Both attachment indexes lead with the tree, so unlike
	 * the other reads the tree test is a plain `=`, which is what lets them be used.
	 */
	attachmentsBySubject(
		treeId: string,
		kind: NoteAttachmentRow['subjectKind'],
		subjectIds: readonly string[]
	): Reads<NoteAttachmentRow> {
		return this.readIn(noteAttachments, subjectIds, (chunk) =>
			this.client
				.select({
					...getTableColumns(noteAttachments),
					rid: sql<number>`${noteAttachments}.rowid`
				})
				.from(noteAttachments)
				.where(
					and(
						eq(noteAttachments.treeId, treeId),
						eq(noteAttachments.subjectKind, kind),
						inArray(noteAttachments.subjectId, chunk)
					)
				)
		);
	}

	attachmentsOfNotes(treeId: string, noteIds: readonly string[]): Reads<NoteAttachmentRow> {
		return this.readIn(noteAttachments, noteIds, (chunk) =>
			this.client
				.select({
					...getTableColumns(noteAttachments),
					rid: sql<number>`${noteAttachments}.rowid`
				})
				.from(noteAttachments)
				.where(and(eq(noteAttachments.treeId, treeId), inArray(noteAttachments.noteId, chunk)))
		);
	}

	tasksIn(treeId: string, ids: readonly string[]): Reads<ResearchTaskRow> {
		return this.readIn(researchTasks, ids, (chunk) =>
			this.client
				.select({ ...getTableColumns(researchTasks), rid: sql<number>`${researchTasks}.rowid` })
				.from(researchTasks)
				.where(and(inTree(researchTasks.treeId, treeId), inArray(researchTasks.id, chunk)))
		);
	}

	tasksBySubject(
		treeId: string,
		kind: NonNullable<ResearchTaskRow['subjectKind']>,
		subjectIds: readonly string[]
	): Reads<ResearchTaskRow> {
		return this.readIn(researchTasks, subjectIds, (chunk) =>
			this.client
				.select({ ...getTableColumns(researchTasks), rid: sql<number>`${researchTasks}.rowid` })
				.from(researchTasks)
				.where(
					and(
						inTree(researchTasks.treeId, treeId),
						eq(researchTasks.subjectKind, kind),
						inArray(researchTasks.subjectId, chunk)
					)
				)
		);
	}
}
