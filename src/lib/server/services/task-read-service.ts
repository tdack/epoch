/**
 * Reads for the tasks page, the person page and the quality report (ADR-029). A task is listed, and
 * its page answers, only for a viewer who may see the record it is about; an unlinked task is
 * visible to every member. A hidden task answers as one that does not exist.
 */

import type { DbClient } from '../db';
import { NotFoundError } from '../domain/errors';
import type { AuthenticatedContext } from '../domain/identity';
import { EvidenceRepository } from '../repositories/evidence-repository';
import { GraphWindowRepository } from '../repositories/graph-window-repository';
import { MemberRepository } from '../repositories/member-repository';
import { NoteRepository } from '../repositories/note-repository';
import { TaskRepository, type TaskFilter } from '../repositories/task-repository';
import { TreeRepository } from '../repositories/tree-repository';
import { UserRepository } from '../repositories/user-repository';
import {
	DEFAULT_TASK_PAGE_SIZE,
	MAX_TASK_PAGE_SIZE,
	TASK_STATUSES,
	type FindingTaskDto,
	type PersonTasksDto,
	type TaskDto,
	type TaskListQuery,
	type TaskPageDto
} from '../../shared/tasks';
import { memberChoice, loadTaskDtos } from './task-dto';
import { requireTreeScope, type ViewerScope } from './tree-access';

const clampPage = (query: { offset?: number; limit?: number }) => ({
	offset: Math.max(0, query.offset ?? 0),
	limit: Math.min(Math.max(query.limit ?? DEFAULT_TASK_PAGE_SIZE, 1), MAX_TASK_PAGE_SIZE)
});

export class TaskReadService {
	private tasks: TaskRepository;
	private readers: {
		graph: GraphWindowRepository;
		evidence: EvidenceRepository;
		notes: NoteRepository;
	};
	private members: MemberRepository;
	private users: UserRepository;
	private trees: TreeRepository;

	constructor(
		db: DbClient,
		private now: () => Date = () => new Date()
	) {
		this.tasks = new TaskRepository(db);
		this.readers = {
			graph: new GraphWindowRepository(db),
			evidence: new EvidenceRepository(db),
			notes: new NoteRepository(db)
		};
		this.members = new MemberRepository(db);
		this.users = new UserRepository(db);
		this.trees = new TreeRepository(db);
	}

	private requireView(treeId: string, context: AuthenticatedContext): Promise<ViewerScope> {
		return requireTreeScope(this.users, this.trees, treeId, context, 'tree:view', this.now());
	}

	/** A page of tasks, open by default, with the counts for the filter tabs and the people who can take one. */
	async listTasks(
		treeId: string,
		query: Partial<TaskListQuery>,
		context: AuthenticatedContext
	): Promise<TaskPageDto> {
		const scope = await this.requireView(treeId, context);
		const page = clampPage(query);
		const base: Omit<TaskFilter, 'status'> = {
			...(query.isMine ? { assigneeId: context.user.id } : {}),
			...(query.subject ? { subject: query.subject } : {}),
			...(query.linked ? { linked: query.linked } : {})
		};
		const status = query.status ?? TASK_STATUSES.OPEN;
		const filter: TaskFilter = { ...base, ...(status === 'all' ? {} : { status }) };
		const [{ ids, hasMore }, counts, members] = await Promise.all([
			this.tasks.taskIds(treeId, filter, page, scope),
			this.tasks.statusCounts(treeId, base, scope),
			this.members.listMembers(treeId)
		]);
		const rows = await this.tasks.tasksByIds(treeId, ids);
		const byId = new Map(rows.map((t) => [t.id, t]));
		const ordered = ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
		return {
			items: await loadTaskDtos(this.readers, treeId, ordered, members, scope),
			hasMore,
			...page,
			counts,
			members: members.map(memberChoice)
		};
	}

	/** The people a task may be given to: current members, by name only. */
	async memberChoices(treeId: string): Promise<Array<{ id: string; name: string }>> {
		return (await this.members.listMembers(treeId)).map(memberChoice);
	}

	async getTask(treeId: string, taskId: string, context: AuthenticatedContext): Promise<TaskDto> {
		const scope = await this.requireView(treeId, context);
		const task = await this.tasks.visibleTask(treeId, taskId, scope);
		if (!task) throw new NotFoundError('Task', taskId);
		const members = await this.members.listMembers(treeId);
		return (await loadTaskDtos(this.readers, treeId, [task], members, scope))[0]!;
	}

	/**
	 * The tasks about a person and their facts, for the person page. The caller has shown the viewer
	 * this person, so their facts and the tasks about them are theirs to see.
	 */
	async tasksOfPerson(
		treeId: string,
		personId: string,
		factIds: readonly string[],
		scope: ViewerScope
	): Promise<PersonTasksDto> {
		const [rows, members] = await Promise.all([
			this.tasks.tasksOfSubjects(treeId, { person: [personId], event: factIds }),
			this.members.listMembers(treeId)
		]);
		return {
			items: await loadTaskDtos(this.readers, treeId, rows, members, scope),
			members: members.map(memberChoice)
		};
	}

	/**
	 * The task each quality finding has, by the finding's key, for the report. A finding may have
	 * several over time; the open one is shown, else the newest.
	 */
	async tasksByFinding(
		treeId: string,
		scope: ViewerScope
	): Promise<Record<string, FindingTaskDto>> {
		const rows = await this.tasks.findingTasks(treeId, scope);
		const byKey: Record<string, FindingTaskDto> = {};
		for (const task of rows) {
			const key = task.findingKey!;
			const current = byKey[key];
			if (current && current.status === TASK_STATUSES.OPEN && task.status !== TASK_STATUSES.OPEN)
				continue;
			byKey[key] = { id: task.id, title: task.title, status: task.status };
		}
		return byKey;
	}
}
