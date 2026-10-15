/**
 * Reads for research tasks (ADR-029). A page is cut in SQL with the visibility predicate beside
 * `tree_id` (`visibility.ts`), so totals, `hasMore` and order are computed over what the viewer may
 * see; a record's own tasks come in one bounded read keyed by `idx_task_subject`.
 */

import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { DbClient } from '../db';
import { researchTasks } from '../db/schema';
import type { ResearchTaskRow } from '../domain/change-log';
import { toImage } from './change-store';
import {
	TASK_STATUS_VALUES,
	type TaskStatus,
	type TaskSubjectKind,
	type TaskSubjectRef
} from '../../shared/tasks';
import type { ViewerScope } from '../services/tree-access';
import { andTaskVisible, withVisibleNoteScope } from './visibility';

type Scope = Pick<ViewerScope, 'isRestricted' | 'cutoff' | 'creatorId'>;

export interface TaskFilter {
	/** A status to list; undefined lists every status. */
	status?: TaskStatus;
	/** Only tasks assigned to this user. */
	assigneeId?: string;
	/** Only tasks about this record. */
	subject?: TaskSubjectRef;
	/** Only tasks about a record of this kind, or `none` for tasks about no record. */
	linked?: TaskSubjectKind | 'none';
}

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

const taskImage = (row: typeof researchTasks.$inferSelect) =>
	toImage(researchTasks, row) as ResearchTaskRow;

/** The filters as a SQL fragment over a `research_tasks` row aliased `t`. */
function filterSql(filter: TaskFilter): SQL {
	return sql`${filter.status ? sql` and t.status = ${filter.status}` : sql``}${
		filter.assigneeId ? sql` and t.assignee_id = ${filter.assigneeId}` : sql``
	}${
		filter.subject
			? sql` and t.subject_kind = ${filter.subject.kind} and t.subject_id = ${filter.subject.id}`
			: sql``
	}${
		filter.linked === 'none'
			? sql` and t.subject_kind is null`
			: filter.linked
				? sql` and t.subject_kind = ${filter.linked}`
				: sql``
	}`;
}

export class TaskRepository {
	constructor(private db: DbClient) {}

	taskIdsSql(treeId: string, filter: TaskFilter, page: PageRequest, scope: Scope): SQL {
		// Undated tasks follow the dated ones, soonest first; `id` ends the key so the order is total.
		return sql`${withVisibleNoteScope(treeId, scope)}select t.id as id from research_tasks t where t.tree_id = ${treeId}${filterSql(filter)}${andTaskVisible('t', scope, treeId)} order by (t.due_date is null), t.due_date, t.id limit ${page.limit + 1} offset ${page.offset}`;
	}

	async taskIds(
		treeId: string,
		filter: TaskFilter,
		page: PageRequest,
		scope: Scope
	): Promise<{ ids: string[]; hasMore: boolean }> {
		const rows = await this.db.all<{ id: string }>(this.taskIdsSql(treeId, filter, page, scope));
		return { ids: rows.slice(0, page.limit).map((r) => r.id), hasMore: rows.length > page.limit };
	}

	async tasksByIds(treeId: string, ids: readonly string[]): Promise<ResearchTaskRow[]> {
		const out: ResearchTaskRow[] = [];
		for (const chunk of chunksOf(ids)) {
			const rows = await this.db
				.select()
				.from(researchTasks)
				.where(and(eq(researchTasks.treeId, treeId), inArray(researchTasks.id, chunk)))
				.all();
			out.push(...rows.map(taskImage));
		}
		return out;
	}

	/** One task, or undefined when it is not in the tree or the viewer may not see it. */
	async visibleTask(
		treeId: string,
		taskId: string,
		scope: Scope
	): Promise<ResearchTaskRow | undefined> {
		const rows = await this.db.all<{ id: string }>(
			sql`${withVisibleNoteScope(treeId, scope)}select t.id as id from research_tasks t where t.tree_id = ${treeId} and t.id = ${taskId}${andTaskVisible('t', scope, treeId)}`
		);
		if (rows.length === 0) return undefined;
		return (await this.tasksByIds(treeId, [taskId]))[0];
	}

	statusCountsSql(treeId: string, filter: Omit<TaskFilter, 'status'>, scope: Scope): SQL {
		return sql`${withVisibleNoteScope(treeId, scope)}select t.status as status, count(*) as n from research_tasks t where t.tree_id = ${treeId}${filterSql(filter)}${andTaskVisible('t', scope, treeId)} group by t.status`;
	}

	/** How many tasks of each status the viewer may see, for the filter tabs. The status filter is not applied. */
	async statusCounts(
		treeId: string,
		filter: Omit<TaskFilter, 'status'>,
		scope: Scope
	): Promise<Record<TaskStatus, number>> {
		const rows = await this.db.all<{ status: TaskStatus; n: number }>(
			this.statusCountsSql(treeId, filter, scope)
		);
		const counts = Object.fromEntries(TASK_STATUS_VALUES.map((s) => [s, 0])) as Record<
			TaskStatus,
			number
		>;
		for (const row of rows) counts[row.status] = row.n;
		return counts;
	}

	/**
	 * Every task about these records, one bounded read per kind. The caller has already decided the
	 * records are the viewer's to see, and a task is visible when the record it is about is.
	 */
	async tasksOfSubjects(
		treeId: string,
		subjects: Partial<Record<TaskSubjectKind, readonly string[]>>
	): Promise<ResearchTaskRow[]> {
		const queries = Object.entries(subjects).flatMap(([kind, ids]) =>
			chunksOf(ids ?? []).map((chunk) =>
				this.db
					.select()
					.from(researchTasks)
					.where(
						and(
							eq(researchTasks.treeId, treeId),
							eq(researchTasks.subjectKind, kind as TaskSubjectKind),
							inArray(researchTasks.subjectId, chunk)
						)
					)
			)
		);
		if (queries.length === 0) return [];
		// D1 batch is typed for a non-empty tuple, and the result type loses the row shape.
		const results = await this.db.batch(queries as unknown as [(typeof queries)[number]]);
		return (results as unknown as Array<Array<typeof researchTasks.$inferSelect>>)
			.flat()
			.map(taskImage);
	}

	/** The tasks made from a quality finding, visible to the viewer: a finding has at most a few. */
	async findingTasks(treeId: string, scope: Scope): Promise<ResearchTaskRow[]> {
		const ids = await this.db.all<{ id: string }>(
			sql`${withVisibleNoteScope(treeId, scope)}select t.id as id from research_tasks t where t.tree_id = ${treeId} and t.finding_key is not null${andTaskVisible('t', scope, treeId)} order by t.rowid`
		);
		return this.tasksByIds(
			treeId,
			ids.map((r) => r.id)
		);
	}
}
