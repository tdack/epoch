/**
 * Reads for the sources pages (ADR-028): the list, a source with its repositories and the records
 * that cite it. A source is listed, and its page answers, only for a viewer who sees something it
 * supports (or who made it); a page for any other is a 404, like a private person's.
 */

import type { DbClient } from '../db';
import { NotFoundError } from '../domain/errors';
import type { AuthenticatedContext } from '../domain/identity';
import type { CitationRow, SourceRow } from '../domain/change-log';
import { eventLabel } from '../domain/tree-labels';
import { EvidenceRepository } from '../repositories/evidence-repository';
import { MediaRepository } from '../repositories/media-repository';
import { NoteRepository } from '../repositories/note-repository';
import { NOTE_SUBJECT_KINDS, type NoteDto } from '../../shared/notes';
import { loadNoteDtos, notesOf } from './note-dto';
import { GraphWindowRepository } from '../repositories/graph-window-repository';
import { TreeRepository } from '../repositories/tree-repository';
import { UserRepository } from '../repositories/user-repository';
import {
	CITATION_SUBJECT_KINDS,
	DEFAULT_EVIDENCE_PAGE_SIZE,
	MAX_EVIDENCE_PAGE_SIZE,
	type RepositoryListItem,
	type SourceCitationGroup,
	type SourceDto,
	type SourceListItem
} from '../../shared/evidence';
import type { Page } from '../../shared/lists';
import { NAME_TYPE_LABELS, type NameType } from '../../shared/name-types';
import { citationDto } from './evidence-dto';
import { personSummaries } from './person-summaries';
import { requireTreeScope, type ViewerScope } from './tree-access';

const clampPage = (query: { offset?: number; limit?: number }) => ({
	offset: Math.max(0, query.offset ?? 0),
	limit: Math.min(Math.max(query.limit ?? DEFAULT_EVIDENCE_PAGE_SIZE, 1), MAX_EVIDENCE_PAGE_SIZE)
});

export class EvidenceReadService {
	private evidence: EvidenceRepository;
	private notes: NoteRepository;
	private media: MediaRepository;
	private graph: GraphWindowRepository;
	private users: UserRepository;
	private trees: TreeRepository;

	constructor(
		private db: DbClient,
		private now: () => Date = () => new Date()
	) {
		this.evidence = new EvidenceRepository(db);
		this.notes = new NoteRepository(db);
		this.media = new MediaRepository(db);
		this.graph = new GraphWindowRepository(db);
		this.users = new UserRepository(db);
		this.trees = new TreeRepository(db);
	}

	private requireView(treeId: string, context: AuthenticatedContext): Promise<ViewerScope> {
		return requireTreeScope(this.users, this.trees, treeId, context, 'tree:view', this.now());
	}

	async listSources(
		treeId: string,
		query: { q?: string; offset?: number; limit?: number },
		context: AuthenticatedContext
	): Promise<Page<SourceListItem>> {
		const scope = await this.requireView(treeId, context);
		const page = clampPage(query);
		const { ids, hasMore } = await this.evidence.sourceIds(
			treeId,
			(query.q ?? '').trim(),
			page,
			scope
		);
		const [rows, counts, fileCounts] = await Promise.all([
			this.evidence.sourcesByIds(treeId, ids),
			this.evidence.visibleCitationCounts(treeId, ids, scope),
			// No privacy join: a source that is listed has all of its files visible (ADR-060).
			this.media.fileCountsOf(treeId, ids)
		]);
		const byId = new Map(rows.map((s) => [s.id, s]));
		const items = ids.flatMap((id) => {
			const s = byId.get(id);
			return s
				? [
						{
							id,
							version: s.version,
							xref: s.xref,
							title: s.title,
							author: s.author,
							abbreviation: s.abbreviation,
							citationCount: counts.get(id) ?? 0,
							fileCount: fileCounts.get(id) ?? 0
						}
					]
				: [];
		});
		return { items, hasMore, ...page };
	}

	async listRepositories(
		treeId: string,
		query: { q?: string; offset?: number; limit?: number },
		context: AuthenticatedContext
	): Promise<Page<RepositoryListItem>> {
		const scope = await this.requireView(treeId, context);
		const page = clampPage(query);
		const { ids, hasMore } = await this.evidence.repositoryIds(
			treeId,
			(query.q ?? '').trim(),
			page,
			scope
		);
		const [rows, counts] = await Promise.all([
			this.evidence.repositoriesByIds(treeId, ids),
			this.evidence.visibleSourceCounts(treeId, ids, scope)
		]);
		const byId = new Map(rows.map((r) => [r.id, r]));
		const items = ids.flatMap((id) => {
			const r = byId.get(id);
			return r
				? [
						{
							id,
							version: r.version,
							name: r.name,
							address: r.address,
							sourceCount: counts.get(id) ?? 0
						}
					]
				: [];
		});
		return { items, hasMore, ...page };
	}

	async getSource(
		treeId: string,
		sourceId: string,
		query: { offset?: number; limit?: number },
		context: AuthenticatedContext
	): Promise<SourceDto> {
		const scope = await this.requireView(treeId, context);
		const source = await this.evidence.visibleSource(treeId, sourceId, scope);
		if (!source) throw new NotFoundError('Source', sourceId);
		const page = clampPage(query);
		const [links, cited, counts] = await Promise.all([
			this.evidence.linksOfSource(treeId, sourceId),
			this.evidence.citationsOfSource(treeId, sourceId, page, scope),
			this.evidence.visibleCitationCounts(treeId, [sourceId], scope)
		]);
		// Notes (ADR-029): the source's own, and those on the citations listed here. The source is the
		// viewer's to see, so its notes are; a citation's are visible as the citation is.
		const noteItems = await loadNoteDtos(
			this.notes,
			treeId,
			await this.notes.attachmentsOf(treeId, {
				[NOTE_SUBJECT_KINDS.SOURCE]: [sourceId],
				[NOTE_SUBJECT_KINDS.CITATION]: cited.rows.map((c) => c.id)
			}),
			scope
		);
		return {
			id: source.id,
			xref: source.xref,
			version: source.version,
			title: source.title,
			author: source.author,
			publication: source.publication,
			abbreviation: source.abbreviation,
			text: source.text,
			notes: notesOf(noteItems, NOTE_SUBJECT_KINDS.SOURCE, sourceId),
			repositories: links.map(({ link, repository }) => ({
				linkId: link.id,
				version: link.version,
				repositoryId: repository?.id ?? null,
				name: repository?.name ?? link.repositoryRef ?? 'Unnamed repository',
				address: repository?.address ?? null,
				callNumber: link.callNumber
			})),
			citationCount: counts.get(sourceId) ?? 0,
			groups: await this.groupBySubject(treeId, cited.rows, source, scope, noteItems),
			hasMore: cited.hasMore,
			offset: page.offset,
			limit: page.limit
		};
	}

	/** The citations of a source, together by what they support, each group named and linked to its person or partnership. */
	private async groupBySubject(
		treeId: string,
		rows: CitationRow[],
		source: SourceRow,
		scope: ViewerScope,
		noteItems: ReadonlyMap<string, NoteDto[]>
	): Promise<SourceCitationGroup[]> {
		const idsOf = (kind: string) =>
			rows.filter((r) => r.subjectKind === kind).map((r) => r.subjectId);
		const [names, facts, links] = await Promise.all([
			this.evidence.namesByIds(treeId, idsOf(CITATION_SUBJECT_KINDS.NAME)),
			this.evidence.eventsByIds(treeId, idsOf(CITATION_SUBJECT_KINDS.EVENT)),
			this.evidence.linksByIds(treeId, idsOf(CITATION_SUBJECT_KINDS.PARENT_CHILD))
		]);
		const unionIds = [
			...idsOf(CITATION_SUBJECT_KINDS.UNION),
			...facts.filter((e) => e.entityType === 'FAMILY').map((e) => e.entityId)
		];
		const [partnerRows] = await this.graph.run(this.graph.partnerRowsOfUnions(treeId, unionIds));
		const partnersOf = (unionId: string) =>
			partnerRows
				.filter((p) => p.row.unionId === unionId)
				.sort((a, b) => a.row.order - b.row.order)
				.map((p) => p.row.personId);
		const personIds = [
			...idsOf(CITATION_SUBJECT_KINDS.PERSON),
			...names.map((n) => n.personId),
			...facts.filter((e) => e.entityType === 'INDIVIDUAL').map((e) => e.entityId),
			...links.flatMap((l) => [l.parentId, l.childId]),
			...partnerRows.map((p) => p.row.personId)
		];
		const people = await personSummaries(this.graph, treeId, undefined, personIds, scope);
		const nameOf = (id: string) => people.get(id)?.displayName ?? 'Unknown';
		const together = (unionId: string) => {
			const names = partnersOf(unionId).map(nameOf);
			return names.length > 0 ? names.join(' and ') : 'a partnership';
		};
		const byName = new Map(names.map((n) => [n.id, n]));
		const byEvent = new Map(facts.map((e) => [e.id, e]));
		const byLink = new Map(links.map((l) => [l.id, l]));

		const sourcesById = new Map([[source.id, source]]);
		const groups = new Map<string, SourceCitationGroup>();
		for (const row of rows) {
			const key = `${row.subjectKind}|${row.subjectId}`;
			let group = groups.get(key);
			if (!group) {
				group = {
					subject: { kind: row.subjectKind, id: row.subjectId },
					label: 'a record',
					personId: null,
					unionId: null,
					citations: []
				};
				switch (row.subjectKind) {
					case CITATION_SUBJECT_KINDS.PERSON:
						group.label = nameOf(row.subjectId);
						group.personId = row.subjectId;
						break;
					case CITATION_SUBJECT_KINDS.UNION:
						group.label = `the partnership of ${together(row.subjectId)}`;
						group.unionId = row.subjectId;
						break;
					case CITATION_SUBJECT_KINDS.NAME: {
						const name = byName.get(row.subjectId);
						if (name) {
							group.label = `the ${NAME_TYPE_LABELS[name.type as NameType].toLowerCase()} of ${nameOf(name.personId)}`;
							group.personId = name.personId;
						}
						break;
					}
					case CITATION_SUBJECT_KINDS.EVENT: {
						const event = byEvent.get(row.subjectId);
						if (event?.entityType === 'INDIVIDUAL') {
							group.label = `the ${eventLabel(event.type).toLowerCase()} of ${nameOf(event.entityId)}`;
							group.personId = event.entityId;
						} else if (event) {
							group.label = `the ${eventLabel(event.type).toLowerCase()} of ${together(event.entityId)}`;
							group.unionId = event.entityId;
						}
						break;
					}
					default: {
						const link = byLink.get(row.subjectId);
						if (link) {
							group.label = `${nameOf(link.parentId)} as parent of ${nameOf(link.childId)}`;
							group.personId = link.childId;
						}
					}
				}
				groups.set(key, group);
			}
			group.citations.push(
				citationDto(row, sourcesById, notesOf(noteItems, NOTE_SUBJECT_KINDS.CITATION, row.id))
			);
		}
		return [...groups.values()];
	}
}
