/**
 * Reads for the notes pages (ADR-029): the list of shared notes, and one note with the records that
 * use it. A shared note is listed, and its page answers, only for a viewer who sees a record that
 * uses it (or who made it); a page for any other is a 404, like a private person's.
 */

import type { DbClient } from '../db';
import { NotFoundError } from '../domain/errors';
import type { AuthenticatedContext } from '../domain/identity';
import type { NoteAttachmentRow } from '../domain/change-log';
import { eventLabel } from '../domain/tree-labels';
import { sourceLabel } from '../../shared/evidence';
import { GraphWindowRepository } from '../repositories/graph-window-repository';
import { EvidenceRepository } from '../repositories/evidence-repository';
import { NoteRepository } from '../repositories/note-repository';
import { TreeRepository } from '../repositories/tree-repository';
import { UserRepository } from '../repositories/user-repository';
import {
	DEFAULT_NOTE_PAGE_SIZE,
	MAX_NOTE_PAGE_SIZE,
	NOTE_SUBJECT_KINDS,
	noteTitle,
	type NoteListItem,
	type NoteUse,
	type SharedNoteDto
} from '../../shared/notes';
import type { Page } from '../../shared/lists';
import { NAME_TYPE_LABELS, type NameType } from '../../shared/name-types';
import { personSummaries } from './person-summaries';
import { requireTreeScope, type ViewerScope } from './tree-access';

const clampPage = (query: { offset?: number; limit?: number }) => ({
	offset: Math.max(0, query.offset ?? 0),
	limit: Math.min(Math.max(query.limit ?? DEFAULT_NOTE_PAGE_SIZE, 1), MAX_NOTE_PAGE_SIZE)
});

export class NoteReadService {
	private notes: NoteRepository;
	private evidence: EvidenceRepository;
	private graph: GraphWindowRepository;
	private users: UserRepository;
	private trees: TreeRepository;

	constructor(
		private db: DbClient,
		private now: () => Date = () => new Date()
	) {
		this.notes = new NoteRepository(db);
		this.evidence = new EvidenceRepository(db);
		this.graph = new GraphWindowRepository(db);
		this.users = new UserRepository(db);
		this.trees = new TreeRepository(db);
	}

	private requireView(treeId: string, context: AuthenticatedContext): Promise<ViewerScope> {
		return requireTreeScope(this.users, this.trees, treeId, context, 'tree:view', this.now());
	}

	async listNotes(
		treeId: string,
		query: { q?: string; offset?: number; limit?: number },
		context: AuthenticatedContext
	): Promise<Page<NoteListItem>> {
		const scope = await this.requireView(treeId, context);
		const page = clampPage(query);
		const { ids, hasMore } = await this.notes.noteIds(treeId, (query.q ?? '').trim(), page, scope);
		const [rows, counts] = await Promise.all([
			this.notes.notesByIds(treeId, ids),
			this.notes.visibleUseCounts(treeId, ids, scope)
		]);
		const byId = new Map(rows.map((n) => [n.id, n]));
		const items = ids.flatMap((id) => {
			const n = byId.get(id);
			return n
				? [{ id, xref: n.xref, title: noteTitle(n.text), useCount: counts.get(id) ?? 0 }]
				: [];
		});
		return { items, hasMore, ...page };
	}

	async getNote(
		treeId: string,
		noteId: string,
		query: { offset?: number; limit?: number },
		context: AuthenticatedContext
	): Promise<SharedNoteDto> {
		const scope = await this.requireView(treeId, context);
		const note = await this.notes.visibleNote(treeId, noteId, scope);
		if (!note) throw new NotFoundError('Note', noteId);
		const page = clampPage(query);
		const [uses, counts] = await Promise.all([
			this.notes.usesOfNote(treeId, noteId, page, scope),
			this.notes.visibleUseCounts(treeId, [noteId], scope)
		]);
		return {
			id: note.id,
			xref: note.xref,
			version: note.version,
			text: note.text ?? '',
			mime: note.mime,
			language: note.language,
			useCount: counts.get(noteId) ?? 0,
			uses: await this.labelUses(treeId, uses.rows, scope),
			hasMore: uses.hasMore,
			offset: page.offset,
			limit: page.limit
		};
	}

	/** The records that use a note, each named and linked to its person, partnership or source. */
	private async labelUses(
		treeId: string,
		rows: NoteAttachmentRow[],
		scope: ViewerScope
	): Promise<NoteUse[]> {
		const idsOf = (kind: string) =>
			rows.filter((r) => r.subjectKind === kind).map((r) => r.subjectId);
		// A note on a citation is about whatever the citation is, so its subject is resolved too.
		const citationRows = await this.evidence.citationsByIds(
			treeId,
			idsOf(NOTE_SUBJECT_KINDS.CITATION)
		);
		const citationById = new Map(citationRows.map((c) => [c.id, c]));
		const subjectsOf = (kind: string) => [
			...idsOf(kind),
			...citationRows.filter((c) => c.subjectKind === kind).map((c) => c.subjectId)
		];
		const [names, facts, links, sourceRows, repositoryRows] = await Promise.all([
			this.evidence.namesByIds(subjectsOf(NOTE_SUBJECT_KINDS.NAME)),
			this.evidence.eventsByIds(treeId, subjectsOf(NOTE_SUBJECT_KINDS.EVENT)),
			this.evidence.linksByIds(treeId, subjectsOf(NOTE_SUBJECT_KINDS.PARENT_CHILD)),
			this.evidence.sourcesByIds(treeId, [
				...idsOf(NOTE_SUBJECT_KINDS.SOURCE),
				...citationRows.flatMap((c) => (c.sourceId ? [c.sourceId] : []))
			]),
			this.evidence.repositoriesByIds(treeId, idsOf(NOTE_SUBJECT_KINDS.REPOSITORY))
		]);
		const unionIds = [
			...subjectsOf(NOTE_SUBJECT_KINDS.UNION),
			...facts.filter((e) => e.entityType === 'FAMILY').map((e) => e.entityId)
		];
		const [partnerRows] = await this.graph.run(this.graph.partnerRowsOfUnions(treeId, unionIds));
		const partnersOf = (unionId: string) =>
			partnerRows
				.filter((p) => p.row.unionId === unionId)
				.sort((a, b) => a.row.order - b.row.order)
				.map((p) => p.row.personId);
		const people = await personSummaries(
			this.graph,
			treeId,
			undefined,
			[
				...subjectsOf(NOTE_SUBJECT_KINDS.PERSON),
				...names.map((n) => n.personId),
				...facts.filter((e) => e.entityType === 'INDIVIDUAL').map((e) => e.entityId),
				...links.flatMap((l) => [l.parentId, l.childId]),
				...partnerRows.map((p) => p.row.personId)
			],
			scope
		);
		const nameOf = (id: string) => people.get(id)?.displayName ?? 'Unknown';
		const together = (unionId: string) => {
			const list = partnersOf(unionId).map(nameOf);
			return list.length > 0 ? list.join(' and ') : 'a partnership';
		};
		const byName = new Map(names.map((n) => [n.id, n]));
		const byEvent = new Map(facts.map((e) => [e.id, e]));
		const byLink = new Map(links.map((l) => [l.id, l]));
		const bySource = new Map(sourceRows.map((s) => [s.id, s]));
		const byRepository = new Map(repositoryRows.map((r) => [r.id, r]));

		/** The words and links for a subject of the citation kinds. */
		const describe = (kind: string, id: string) => {
			const out = {
				label: 'a record',
				personId: null as string | null,
				unionId: null as string | null
			};
			switch (kind) {
				case NOTE_SUBJECT_KINDS.PERSON:
					return { label: nameOf(id), personId: id, unionId: null };
				case NOTE_SUBJECT_KINDS.UNION:
					return { label: `the partnership of ${together(id)}`, personId: null, unionId: id };
				case NOTE_SUBJECT_KINDS.NAME: {
					const name = byName.get(id);
					if (name) {
						out.label = `the ${NAME_TYPE_LABELS[name.type as NameType].toLowerCase()} of ${nameOf(name.personId)}`;
						out.personId = name.personId;
					}
					return out;
				}
				case NOTE_SUBJECT_KINDS.EVENT: {
					const event = byEvent.get(id);
					if (event?.entityType === 'INDIVIDUAL') {
						out.label = `the ${eventLabel(event.type).toLowerCase()} of ${nameOf(event.entityId)}`;
						out.personId = event.entityId;
					} else if (event) {
						out.label = `the ${eventLabel(event.type).toLowerCase()} of ${together(event.entityId)}`;
						out.unionId = event.entityId;
					}
					return out;
				}
				default: {
					const link = byLink.get(id);
					if (link) {
						out.label = `${nameOf(link.parentId)} as parent of ${nameOf(link.childId)}`;
						out.personId = link.childId;
					}
					return out;
				}
			}
		};

		return rows.map((row): NoteUse => {
			const subject = { kind: row.subjectKind, id: row.subjectId };
			const base = { attachmentId: row.id, subject, personId: null, unionId: null, sourceId: null };
			if (row.subjectKind === NOTE_SUBJECT_KINDS.SOURCE) {
				const source = bySource.get(row.subjectId);
				return {
					...base,
					label: source ? `the source “${sourceLabel(source)}”` : 'a source',
					sourceId: source?.id ?? null
				};
			}
			if (row.subjectKind === NOTE_SUBJECT_KINDS.REPOSITORY) {
				const repository = byRepository.get(row.subjectId);
				return { ...base, label: `the repository “${repository?.name ?? 'Unnamed'}”` };
			}
			if (row.subjectKind === NOTE_SUBJECT_KINDS.CITATION) {
				const citation = citationById.get(row.subjectId);
				if (!citation) return { ...base, label: 'a citation' };
				const of = describe(citation.subjectKind, citation.subjectId);
				return {
					...base,
					label: `a citation of ${of.label}`,
					personId: of.personId,
					unionId: of.unionId,
					sourceId: citation.sourceId
				};
			}
			return { ...base, ...describe(row.subjectKind, row.subjectId) };
		});
	}
}
