/**
 * Reads for notes (ADR-029). Pages are cut in SQL with the visibility predicate beside `tree_id`
 * (`visibility.ts`), so totals, `hasMore` and order are computed over what the viewer may see; a
 * record's own notes come in one batch of bounded reads, keyed by the index on subject.
 */

import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { DbClient } from '../db';
import { noteAttachments, notes } from '../db/schema';
import type { NoteAttachmentRow, NoteRow } from '../domain/change-log';
import { toImage } from './change-store';
import type { NoteSubjectKind } from '../../shared/notes';
import type { ViewerScope } from '../services/tree-access';
import { andNoteAttachmentVisible, andNoteVisible, withVisibleNoteScope } from './visibility';

type Scope = Pick<ViewerScope, 'isRestricted' | 'cutoff' | 'creatorId'>;

export interface PageRequest {
	offset: number;
	limit: number;
}

/** Ids per `IN (...)`, under D1's 100 bound parameters with the tree id and filters. */
const IDS_PER_QUERY = 80;

const chunksOf = <T>(items: readonly T[], size = IDS_PER_QUERY): T[][] => {
	const unique = [...new Set(items)];
	const chunks: T[][] = [];
	for (let i = 0; i < unique.length; i += size) chunks.push(unique.slice(i, i + size));
	return chunks;
};

/** `%` and `_` in a search are the text, not wildcards. */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Rows as the mutation snapshot has them, so the read services and the planner share one shape. */
const noteImage = (row: typeof notes.$inferSelect) =>
	toImage(notes, row as unknown as Record<string, unknown>) as NoteRow;
const attachmentImage = (row: typeof noteAttachments.$inferSelect) =>
	toImage(noteAttachments, row as unknown as Record<string, unknown>) as NoteAttachmentRow;

/** The subjects whose notes a page wants, by kind. */
export type SubjectIds = Partial<Record<NoteSubjectKind, readonly string[]>>;

export class NoteRepository {
	constructor(private db: DbClient) {}

	// ---- Shared notes ----

	noteIdsSql(treeId: string, query: string, page: PageRequest, scope: Scope): SQL {
		const search = query ? sql` and n.text like ${likePattern(query)} escape '\\'` : sql``;
		return sql`${withVisibleNoteScope(treeId, scope)}select n.id as id from notes n where n.tree_id = ${treeId}${search}${andNoteVisible('n', scope)} order by n.text collate nocase, n.id limit ${page.limit + 1} offset ${page.offset}`;
	}

	async noteIds(
		treeId: string,
		query: string,
		page: PageRequest,
		scope: Scope
	): Promise<{ ids: string[]; hasMore: boolean }> {
		const rows = await this.db.all<{ id: string }>(this.noteIdsSql(treeId, query, page, scope));
		return { ids: rows.slice(0, page.limit).map((r) => r.id), hasMore: rows.length > page.limit };
	}

	async notesByIds(treeId: string, ids: readonly string[]): Promise<NoteRow[]> {
		const out: NoteRow[] = [];
		for (const chunk of chunksOf(ids)) {
			const rows = await this.db
				.select()
				.from(notes)
				.where(and(eq(notes.treeId, treeId), inArray(notes.id, chunk)))
				.all();
			out.push(...rows.map(noteImage));
		}
		return out;
	}

	/** One shared note, or undefined when it is not in the tree or the viewer may not see it. */
	async visibleNote(treeId: string, noteId: string, scope: Scope): Promise<NoteRow | undefined> {
		const rows = await this.db.all<{ id: string }>(
			sql`${withVisibleNoteScope(treeId, scope)}select n.id as id from notes n where n.tree_id = ${treeId} and n.id = ${noteId}${andNoteVisible('n', scope)}`
		);
		if (rows.length === 0) return undefined;
		return (await this.notesByIds(treeId, [noteId]))[0];
	}

	/** How many attachments of each shared note the viewer may see. */
	async visibleUseCounts(
		treeId: string,
		noteIds: readonly string[],
		scope: Scope
	): Promise<Map<string, number>> {
		const counts = new Map<string, number>();
		for (const chunk of chunksOf(noteIds)) {
			const rows = await this.db.all<{ id: string; n: number }>(
				sql`${withVisibleNoteScope(treeId, scope)}select a.note_id as id, count(*) as n from note_attachments a where a.tree_id = ${treeId} and a.note_id in (${sql.join(
					chunk.map((id) => sql`${id}`),
					sql`, `
				)})${andNoteAttachmentVisible('a', scope, treeId)} group by a.note_id`
			);
			for (const row of rows) counts.set(row.id, row.n);
		}
		return counts;
	}

	/** A page of the attachments of one shared note the viewer may see, in the order they were written. */
	async usesOfNote(
		treeId: string,
		noteId: string,
		page: PageRequest,
		scope: Scope
	): Promise<{ rows: NoteAttachmentRow[]; hasMore: boolean }> {
		const ids = await this.db.all<{ id: string }>(
			sql`${withVisibleNoteScope(treeId, scope)}select a.id as id from note_attachments a where a.tree_id = ${treeId} and a.note_id = ${noteId}${andNoteAttachmentVisible('a', scope, treeId)} order by a.rowid limit ${page.limit + 1} offset ${page.offset}`
		);
		const wanted = ids.slice(0, page.limit).map((r) => r.id);
		const found = new Map<string, NoteAttachmentRow>();
		for (const chunk of chunksOf(wanted)) {
			const rows = await this.db
				.select()
				.from(noteAttachments)
				.where(and(eq(noteAttachments.treeId, treeId), inArray(noteAttachments.id, chunk)))
				.all();
			for (const row of rows) found.set(row.id, attachmentImage(row));
		}
		return {
			rows: wanted.flatMap((id) => (found.has(id) ? [found.get(id)!] : [])),
			hasMore: ids.length > page.limit
		};
	}

	/**
	 * The id of every attachment in the tree the viewer may see. Nothing pages by it; it is how the
	 * SQL predicate is held to the same answers as the row filter, for every kind of subject.
	 */
	async visibleAttachmentIds(treeId: string, scope: Scope): Promise<string[]> {
		const rows = await this.db.all<{ id: string }>(
			sql`${withVisibleNoteScope(treeId, scope)}select a.id as id from note_attachments a where a.tree_id = ${treeId}${andNoteAttachmentVisible('a', scope, treeId)}`
		);
		return rows.map((r) => r.id);
	}

	// ---- The notes of a record ----

	/**
	 * Every attachment of these subjects, one bounded read per kind in one batch. The caller has
	 * already decided the subjects are the viewer's to see: a note is visible when its subject is.
	 */
	async attachmentsOf(treeId: string, subjects: SubjectIds): Promise<NoteAttachmentRow[]> {
		const queries = Object.entries(subjects).flatMap(([kind, ids]) =>
			chunksOf(ids ?? []).map((chunk) =>
				this.db
					.select()
					.from(noteAttachments)
					.where(
						and(
							eq(noteAttachments.treeId, treeId),
							eq(noteAttachments.subjectKind, kind as NoteSubjectKind),
							inArray(noteAttachments.subjectId, chunk)
						)
					)
					.orderBy(asc(noteAttachments.sortOrder))
			)
		);
		if (queries.length === 0) return [];
		const results = await this.db.batch(queries as unknown as [(typeof queries)[number]]);
		return (results as unknown as Array<(typeof noteAttachments.$inferSelect)[]>)
			.flat()
			.map(attachmentImage);
	}
}
