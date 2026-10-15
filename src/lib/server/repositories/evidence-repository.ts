/**
 * Reads for sources, repositories and citations (ADR-028). Pages are cut in SQL with the visibility
 * predicate beside `tree_id` (`visibility.ts`), so totals, `hasMore` and order are computed over what
 * the viewer may see; a person's or partnership's citations come in one batch of bounded reads.
 */

import { and, asc, eq, getTableColumns, inArray, sql, type SQL } from 'drizzle-orm';
import type { DbClient } from '../db';
import {
	citations,
	events,
	individuals,
	parentChild,
	personNames,
	repositories,
	sourceRepositories,
	sources
} from '../db/schema';
import type { CitationRow, RepositoryRow, SourceRow } from '../domain/change-log';
import { toImage } from './change-store';
import { CITATION_SUBJECT_KINDS, type CitationSubjectKind } from '../../shared/evidence';
import type { ViewerScope } from '../services/tree-access';
import {
	andRepositoryVisible,
	andSourceVisible,
	isCitationVisibleOf,
	withVisiblePeople
} from './visibility';

type Scope = Pick<ViewerScope, 'isRestricted' | 'cutoff' | 'creatorId'>;

export interface PageRequest {
	offset: number;
	limit: number;
}

/** Ids per `IN (...)`, under D1's 100 bound parameters with the tree id and filters. */
const IDS_PER_QUERY = 80;
const CITATION_COUNT_IDS_PER_QUERY = 50;

const chunksOf = <T>(items: readonly T[], size = IDS_PER_QUERY): T[][] => {
	const unique = [...new Set(items)];
	const chunks: T[][] = [];
	for (let i = 0; i < unique.length; i += size) chunks.push(unique.slice(i, i + size));
	return chunks;
};

/** `%` and `_` in a search are the text, not wildcards. */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** A citation row as the mutation snapshot has it, so the read services and the planner share one shape. */
const citationImage = (row: typeof citations.$inferSelect) =>
	toImage(citations, row) as CitationRow;

/** Whether a citation is the viewer's to see, as a drizzle condition on the `citations` table itself. */
const visibleCitation = (treeId: string, scope: Scope): SQL | undefined =>
	scope.isRestricted ? sql`${isCitationVisibleOf('citations', scope, treeId)}` : undefined;

export class EvidenceRepository {
	constructor(private db: DbClient) {}

	// ---- Sources ----

	sourceIdsSql(treeId: string, query: string, page: PageRequest, scope: Scope): SQL {
		const search = query
			? sql` and (s.title like ${likePattern(query)} escape '\\' or s.author like ${likePattern(query)} escape '\\' or s.abbreviation like ${likePattern(query)} escape '\\')`
			: sql``;
		return sql`${withVisiblePeople(treeId, scope)}select s.id as id from sources s where s.tree_id = ${treeId}${search}${andSourceVisible('s', scope, treeId)} order by s.title collate nocase, s.id limit ${page.limit + 1} offset ${page.offset}`;
	}

	async sourceIds(
		treeId: string,
		query: string,
		page: PageRequest,
		scope: Scope
	): Promise<{ ids: string[]; hasMore: boolean }> {
		const rows = await this.db.all<{ id: string }>(this.sourceIdsSql(treeId, query, page, scope));
		return { ids: rows.slice(0, page.limit).map((r) => r.id), hasMore: rows.length > page.limit };
	}

	async sourcesByIds(treeId: string, ids: readonly string[]): Promise<SourceRow[]> {
		const out: SourceRow[] = [];
		for (const chunk of chunksOf(ids)) {
			const rows = await this.db
				.select()
				.from(sources)
				.where(and(eq(sources.treeId, treeId), inArray(sources.id, chunk)))
				.all();
			out.push(...rows.map((r) => toImage(sources, r as never) as SourceRow));
		}
		return out;
	}

	/** One source, or undefined when it is not in the tree or the viewer may not see it. */
	async visibleSource(
		treeId: string,
		sourceId: string,
		scope: Scope
	): Promise<SourceRow | undefined> {
		const rows = await this.db.all<{ id: string }>(
			sql`${withVisiblePeople(treeId, scope)}select s.id as id from sources s where s.tree_id = ${treeId} and s.id = ${sourceId}${andSourceVisible('s', scope, treeId)}`
		);
		if (rows.length === 0) return undefined;
		return (await this.sourcesByIds(treeId, [sourceId]))[0];
	}

	/** How many citations of each source the viewer may see. */
	async visibleCitationCounts(
		treeId: string,
		sourceIds: readonly string[],
		scope: Scope
	): Promise<Map<string, number>> {
		const counts = new Map<string, number>();
		// Not the 80-id default: the visibility fragment binds about 25 parameters with a creator test,
		// so 80 ids pass D1's limit of 100 for a contributor (found by the F12 to F18 review).
		for (const chunk of chunksOf(sourceIds, CITATION_COUNT_IDS_PER_QUERY)) {
			const rows = await this.db
				.select({ sourceId: citations.sourceId, n: sql<number>`count(*)` })
				.from(citations)
				.where(
					and(
						eq(citations.treeId, treeId),
						inArray(citations.sourceId, chunk),
						visibleCitation(treeId, scope)
					)
				)
				.groupBy(citations.sourceId)
				.all();
			for (const row of rows) if (row.sourceId) counts.set(row.sourceId, row.n);
		}
		return counts;
	}

	/** A page of the citations of one source the viewer may see, in the order they were written. */
	async citationsOfSource(
		treeId: string,
		sourceId: string,
		page: PageRequest,
		scope: Scope
	): Promise<{ rows: CitationRow[]; hasMore: boolean }> {
		const rows = await this.db
			.select()
			.from(citations)
			.where(
				and(
					eq(citations.treeId, treeId),
					eq(citations.sourceId, sourceId),
					visibleCitation(treeId, scope)
				)
			)
			.orderBy(sql`${citations}.rowid`)
			.limit(page.limit + 1)
			.offset(page.offset)
			.all();
		return {
			rows: rows.slice(0, page.limit).map(citationImage),
			hasMore: rows.length > page.limit
		};
	}

	// ---- Repositories ----

	repositoryIdsSql(treeId: string, query: string, page: PageRequest, scope: Scope): SQL {
		const search = query ? sql` and r.name like ${likePattern(query)} escape '\\'` : sql``;
		return sql`${withVisiblePeople(treeId, scope)}select r.id as id from repositories r where r.tree_id = ${treeId}${search}${andRepositoryVisible('r', scope, treeId)} order by r.name collate nocase, r.id limit ${page.limit + 1} offset ${page.offset}`;
	}

	async repositoryIds(
		treeId: string,
		query: string,
		page: PageRequest,
		scope: Scope
	): Promise<{ ids: string[]; hasMore: boolean }> {
		const rows = await this.db.all<{ id: string }>(
			this.repositoryIdsSql(treeId, query, page, scope)
		);
		return { ids: rows.slice(0, page.limit).map((r) => r.id), hasMore: rows.length > page.limit };
	}

	async repositoriesByIds(treeId: string, ids: readonly string[]): Promise<RepositoryRow[]> {
		const out: RepositoryRow[] = [];
		for (const chunk of chunksOf(ids)) {
			const rows = await this.db
				.select()
				.from(repositories)
				.where(and(eq(repositories.treeId, treeId), inArray(repositories.id, chunk)))
				.all();
			out.push(...rows.map((r) => toImage(repositories, r as never) as RepositoryRow));
		}
		return out;
	}

	/** How many of the viewer's visible sources are kept at each repository. */
	async visibleSourceCounts(
		treeId: string,
		repositoryIds: readonly string[],
		scope: Scope
	): Promise<Map<string, number>> {
		const counts = new Map<string, number>();
		for (const chunk of chunksOf(repositoryIds)) {
			const rows = await this.db.all<{ id: string; n: number }>(
				sql`${withVisiblePeople(treeId, scope)}select l.repository_id as id, count(distinct l.source_id) as n from source_repositories l join sources s on s.id = l.source_id where s.tree_id = ${treeId} and l.repository_id in (${sql.join(
					chunk.map((id) => sql`${id}`),
					sql`, `
				)})${andSourceVisible('s', scope, treeId)} group by l.repository_id`
			);
			for (const row of rows) counts.set(row.id, row.n);
		}
		return counts;
	}

	/** Citations by id, as the mutation snapshot has them, for naming what a note on one is about. */
	async citationsByIds(treeId: string, ids: readonly string[]): Promise<CitationRow[]> {
		const out: CitationRow[] = [];
		for (const chunk of chunksOf(ids)) {
			const rows = await this.db
				.select()
				.from(citations)
				.where(and(eq(citations.treeId, treeId), inArray(citations.id, chunk)))
				.all();
			out.push(...rows.map(citationImage));
		}
		return out;
	}

	/**
	 * A source's repository links, in order, with the repositories they name. The source must be in
	 * this tree, and a repository is named only when it is too, so a link to another tree's repository
	 * comes back with no repository. The tree test sits in the join's `on`, not `where`, so such a
	 * link is kept rather than dropped.
	 */
	async linksOfSource(treeId: string, sourceId: string) {
		return this.db
			.select({
				link: getTableColumns(sourceRepositories),
				repository: getTableColumns(repositories)
			})
			.from(sourceRepositories)
			.innerJoin(
				sources,
				and(eq(sources.id, sourceRepositories.sourceId), eq(sources.treeId, treeId))
			)
			.leftJoin(
				repositories,
				and(eq(sourceRepositories.repositoryId, repositories.id), eq(repositories.treeId, treeId))
			)
			.where(eq(sourceRepositories.sourceId, sourceId))
			.orderBy(asc(sourceRepositories.sortOrder))
			.all();
	}

	// ---- Citations of a person or a partnership ----

	/**
	 * Every citation of a person and of what they have: the person, their names, their facts, and the
	 * links where they are the child. Four bounded reads in one batch; the parent id of a link rides
	 * along so the page can name it.
	 */
	async citationsOfPerson(
		treeId: string,
		personId: string,
		scope: Scope
	): Promise<{ rows: CitationRow[]; linkParents: Map<string, string> }> {
		const visible = visibleCitation(treeId, scope);
		const base = (kind: CitationSubjectKind) =>
			and(eq(citations.treeId, treeId), eq(citations.subjectKind, kind));
		const [direct, ofNames, ofFacts, ofLinks] = await this.db.batch([
			this.db
				.select()
				.from(citations)
				.where(
					and(base(CITATION_SUBJECT_KINDS.PERSON), eq(citations.subjectId, personId), visible)
				),
			this.db
				.select(getTableColumns(citations))
				.from(citations)
				.innerJoin(personNames, eq(personNames.id, citations.subjectId))
				.where(and(base(CITATION_SUBJECT_KINDS.NAME), eq(personNames.personId, personId), visible)),
			this.db
				.select(getTableColumns(citations))
				.from(citations)
				.innerJoin(events, eq(events.id, citations.subjectId))
				.where(
					and(
						base(CITATION_SUBJECT_KINDS.EVENT),
						eq(events.entityType, 'INDIVIDUAL'),
						eq(events.entityId, personId),
						visible
					)
				),
			this.db
				.select({ ...getTableColumns(citations), parentId: parentChild.parentId })
				.from(citations)
				.innerJoin(parentChild, eq(parentChild.id, citations.subjectId))
				.where(
					and(base(CITATION_SUBJECT_KINDS.PARENT_CHILD), eq(parentChild.childId, personId), visible)
				)
		]);
		const linkParents = new Map<string, string>();
		const linkRows = ofLinks.map(({ parentId, ...row }) => {
			linkParents.set(row.subjectId, parentId);
			return row;
		});
		return {
			rows: [...direct, ...ofNames, ...ofFacts, ...linkRows].map(citationImage),
			linkParents
		};
	}

	/** Every citation of a partnership, its facts, and the parent links filed under it. */
	async citationsOfUnion(
		treeId: string,
		unionId: string,
		scope: Scope
	): Promise<{
		rows: CitationRow[];
		linkParents: Map<string, string>;
		linkChildren: Map<string, string>;
	}> {
		const visible = visibleCitation(treeId, scope);
		const base = (kind: CitationSubjectKind) =>
			and(eq(citations.treeId, treeId), eq(citations.subjectKind, kind));
		const [direct, ofFacts, ofLinks] = await this.db.batch([
			this.db
				.select()
				.from(citations)
				.where(and(base(CITATION_SUBJECT_KINDS.UNION), eq(citations.subjectId, unionId), visible)),
			this.db
				.select(getTableColumns(citations))
				.from(citations)
				.innerJoin(events, eq(events.id, citations.subjectId))
				.where(
					and(
						base(CITATION_SUBJECT_KINDS.EVENT),
						eq(events.entityType, 'FAMILY'),
						eq(events.entityId, unionId),
						visible
					)
				),
			this.db
				.select({
					...getTableColumns(citations),
					parentId: parentChild.parentId,
					childId: parentChild.childId
				})
				.from(citations)
				.innerJoin(parentChild, eq(parentChild.id, citations.subjectId))
				.where(
					and(base(CITATION_SUBJECT_KINDS.PARENT_CHILD), eq(parentChild.unionId, unionId), visible)
				)
		]);
		const linkParents = new Map<string, string>();
		const linkChildren = new Map<string, string>();
		const linkRows = ofLinks.map(({ parentId, childId, ...row }) => {
			linkParents.set(row.subjectId, parentId);
			linkChildren.set(row.subjectId, childId);
			return row;
		});
		return {
			rows: [...direct, ...ofFacts, ...linkRows].map(citationImage),
			linkParents,
			linkChildren
		};
	}

	/** Every id-and-subject of the citations whose source or subject a page names, for resolving labels. */
	async namesByIds(treeId: string, ids: readonly string[]) {
		const out: Array<typeof personNames.$inferSelect> = [];
		for (const chunk of chunksOf(ids))
			out.push(
				...(await this.db
					.select(getTableColumns(personNames))
					.from(personNames)
					.innerJoin(individuals, eq(individuals.id, personNames.personId))
					.where(and(sql`+${individuals.treeId} = ${treeId}`, inArray(personNames.id, chunk)))
					.all())
			);
		return out;
	}

	async eventsByIds(treeId: string, ids: readonly string[]) {
		const out: Array<typeof events.$inferSelect> = [];
		for (const chunk of chunksOf(ids))
			out.push(
				...(await this.db
					.select()
					.from(events)
					.where(and(eq(events.treeId, treeId), inArray(events.id, chunk)))
					.all())
			);
		return out;
	}

	async linksByIds(treeId: string, ids: readonly string[]) {
		const out: Array<typeof parentChild.$inferSelect> = [];
		for (const chunk of chunksOf(ids))
			out.push(
				...(await this.db
					.select()
					.from(parentChild)
					.where(and(eq(parentChild.treeId, treeId), inArray(parentChild.id, chunk)))
					.all())
			);
		return out;
	}
}
