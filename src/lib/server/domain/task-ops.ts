/**
 * Row operations for research tasks (ADR-029): create, edit and delete one, and the two rules that
 * keep a task right when its record changes. A merge moves the tasks of the record folded away to
 * the one that remains (`makeTaskMover`); a delete clears the link and keeps the task, which says
 * what kind of record it was about (`taskCascadeOps`). Both are ops in the same logged change, so an
 * undo restores them.
 */

import type { ResearchTaskRow, RowOp, TreeRows } from './change-log';
import { ConcurrencyConflictError, NotFoundError, ValidationError } from './errors';
import {
	MAX_TASK_DETAILS_LENGTH,
	MAX_TASK_TITLE_LENGTH,
	TASK_STATUSES,
	TASK_SUBJECT_KINDS,
	isDueDate,
	isTaskStatus,
	type TaskInput,
	type TaskSubjectKind,
	type TaskSubjectRef
} from '../../shared/tasks';

export type TaskCommand =
	| {
			kind: 'create_task';
			taskId: string;
			task: TaskInput & { title: string };
			/** The record it is about, if any. */
			subject?: TaskSubjectRef | null;
			/** The quality finding it was made from, by the report's key. */
			findingKey?: string | null;
	  }
	| { kind: 'update_task'; taskId: string; expectedVersion?: number; task: TaskInput }
	| { kind: 'delete_task'; taskId: string; expectedVersion?: number };

export interface TaskContext {
	treeId: string;
	/** Epoch milliseconds, stamped on every row written. */
	now: number;
	/** The user making the change, recorded as the author of a task it creates. */
	actorId: string | null;
}

const clean = (value: string | null | undefined): string | null => value?.trim() || null;
const cleanBlock = (value: string | null | undefined): string | null =>
	value?.replace(/\r\n?/g, '\n').trim() || null;

export function requireTask(rows: TreeRows, id: string): ResearchTaskRow {
	const task = rows.researchTasks.find((t) => t.id === id);
	if (!task) throw new NotFoundError('Task', id);
	return task;
}

/** Throws when the record a task would be about is not in the tree. */
function requireSubject(rows: TreeRows, subject: TaskSubjectRef): void {
	const lists: Record<TaskSubjectKind, Array<{ id: string }>> = {
		[TASK_SUBJECT_KINDS.PERSON]: rows.individuals,
		[TASK_SUBJECT_KINDS.UNION]: rows.unions,
		[TASK_SUBJECT_KINDS.EVENT]: rows.events,
		[TASK_SUBJECT_KINDS.SOURCE]: rows.sources,
		[TASK_SUBJECT_KINDS.NOTE]: rows.notes
	};
	if (!lists[subject.kind]?.some((row) => row.id === subject.id))
		throw new NotFoundError('Record for the task', subject.id);
}

function validateTitle(title: string | null): string {
	if (!title) throw new ValidationError('A task needs a title.');
	if (title.length > MAX_TASK_TITLE_LENGTH)
		throw new ValidationError(`A task title is at most ${MAX_TASK_TITLE_LENGTH} characters.`);
	return title;
}

function validateDetails(details: string | null): string | null {
	if (details && details.length > MAX_TASK_DETAILS_LENGTH)
		throw new ValidationError(
			`A task’s details are at most ${MAX_TASK_DETAILS_LENGTH} characters.`
		);
	return details;
}

function validateDue(dueDate: string | null): string | null {
	if (dueDate !== null && !isDueDate(dueDate))
		throw new ValidationError('A due date is a calendar date, such as 2027-03-31.');
	return dueDate;
}

const snapshot = (t: ResearchTaskRow) => ({
	title: t.title,
	details: t.details,
	status: t.status,
	assigneeId: t.assigneeId,
	dueDate: t.dueDate
});

function checkVersion(task: ResearchTaskRow, expected: number | undefined): void {
	if (expected === undefined || task.version === expected) return;
	throw new ConcurrencyConflictError(
		`This task was changed by someone else (you had version ${expected}, it is now ${task.version}).`,
		{
			reason: 'STALE_VERSION',
			entity: 'task',
			id: task.id,
			expectedVersion: expected,
			currentVersion: task.version,
			current: snapshot(task)
		}
	);
}

function touch(task: ResearchTaskRow, ctx: Pick<TaskContext, 'now'>): ResearchTaskRow {
	return { ...task, version: task.version + 1, updatedAt: ctx.now };
}

function createTask(
	rows: TreeRows,
	ctx: TaskContext,
	command: Extract<TaskCommand, { kind: 'create_task' }>
): RowOp[] {
	const { task } = command;
	if (command.subject) requireSubject(rows, command.subject);
	const status = task.status ?? TASK_STATUSES.OPEN;
	if (!isTaskStatus(status)) throw new ValidationError('A task is open, done or dropped.');
	const row: ResearchTaskRow = {
		id: command.taskId,
		treeId: ctx.treeId,
		title: validateTitle(clean(task.title)),
		details: validateDetails(cleanBlock(task.details)),
		status,
		assigneeId: task.assigneeId ?? null,
		dueDate: validateDue(task.dueDate ?? null),
		subjectKind: command.subject?.kind ?? null,
		subjectId: command.subject?.id ?? null,
		findingKey: clean(command.findingKey),
		linkClearedKind: null,
		createdBy: ctx.actorId,
		version: 1,
		createdAt: ctx.now,
		updatedAt: ctx.now
	};
	return [{ table: 'research_tasks', id: row.id, before: null, after: row }];
}

function updateTask(
	rows: TreeRows,
	ctx: TaskContext,
	command: Extract<TaskCommand, { kind: 'update_task' }>
): RowOp[] {
	const before = requireTask(rows, command.taskId);
	checkVersion(before, command.expectedVersion);
	const patch = command.task;
	if (patch.status !== undefined && !isTaskStatus(patch.status))
		throw new ValidationError('A task is open, done or dropped.');
	const after: ResearchTaskRow = {
		...before,
		title: patch.title !== undefined ? validateTitle(clean(patch.title)) : before.title,
		details:
			patch.details !== undefined ? validateDetails(cleanBlock(patch.details)) : before.details,
		status: patch.status ?? before.status,
		assigneeId: patch.assigneeId !== undefined ? patch.assigneeId : before.assigneeId,
		dueDate: patch.dueDate !== undefined ? validateDue(patch.dueDate) : before.dueDate
	};
	if (JSON.stringify(after) === JSON.stringify(before)) return [];
	return [{ table: 'research_tasks', id: before.id, before, after: touch(after, ctx) }];
}

function deleteTask(
	rows: TreeRows,
	_ctx: TaskContext,
	command: Extract<TaskCommand, { kind: 'delete_task' }>
): RowOp[] {
	const task = requireTask(rows, command.taskId);
	checkVersion(task, command.expectedVersion);
	return [{ table: 'research_tasks', id: task.id, before: task, after: null }];
}

export function buildTaskOps(rows: TreeRows, command: TaskCommand, ctx: TaskContext): RowOp[] {
	switch (command.kind) {
		case 'create_task':
			return createTask(rows, ctx, command);
		case 'update_task':
			return updateTask(rows, ctx, command);
		case 'delete_task':
			return deleteTask(rows, ctx, command);
	}
}

// ---- Tasks follow the record they are about ----

const TASK_SUBJECT_TABLES = {
	individuals: TASK_SUBJECT_KINDS.PERSON,
	unions: TASK_SUBJECT_KINDS.UNION,
	events: TASK_SUBJECT_KINDS.EVENT,
	sources: TASK_SUBJECT_KINDS.SOURCE,
	notes: TASK_SUBJECT_KINDS.NOTE
} as const;

/**
 * Updates that clear the link of every task about a record these ops delete, so no command that
 * removes a person, a fact, a partnership, a source or a shared note has to remember its tasks. The
 * task stays, and `linkClearedKind` says what it was about; undo restores the link with the record.
 * A task an op already handles (a merge moving it) is left to that op.
 */
export function taskCascadeOps(
	rows: TreeRows,
	ops: RowOp[],
	ctx: Pick<TaskContext, 'now'>
): RowOp[] {
	if (rows.researchTasks.length === 0) return [];
	const gone = new Set(
		ops
			.filter((op) => op.after === null && op.table in TASK_SUBJECT_TABLES)
			.map((op) => `${TASK_SUBJECT_TABLES[op.table as keyof typeof TASK_SUBJECT_TABLES]}|${op.id}`)
	);
	if (gone.size === 0) return [];
	const handled = new Set(ops.filter((op) => op.table === 'research_tasks').map((op) => op.id));
	return rows.researchTasks
		.filter(
			(t) =>
				t.subjectKind !== null && gone.has(`${t.subjectKind}|${t.subjectId}`) && !handled.has(t.id)
		)
		.map((t): RowOp => ({
			table: 'research_tasks',
			id: t.id,
			before: t,
			after: {
				...t,
				linkClearedKind: t.subjectKind,
				subjectKind: null,
				subjectId: null,
				version: t.version + 1,
				updatedAt: ctx.now
			}
		}));
}

/**
 * Moves the tasks about one record to another, for the commands that fold one record into another:
 * a task about the person merged away is now about the survivor. A record that goes to a kind of
 * record tasks cannot be about (a name, a parent link) takes none.
 */
export function makeTaskMover(rows: TreeRows, ctx: Pick<TaskContext, 'now'>) {
	return {
		move(from: { kind: string; id: string }, to: { kind: string; id: string }): RowOp[] {
			if (!Object.values(TASK_SUBJECT_KINDS).includes(to.kind as TaskSubjectKind)) return [];
			return rows.researchTasks
				.filter((t) => t.subjectKind === from.kind && t.subjectId === from.id)
				.map((t): RowOp => ({
					table: 'research_tasks',
					id: t.id,
					before: t,
					after: {
						...t,
						subjectKind: to.kind as TaskSubjectKind,
						subjectId: to.id,
						version: t.version + 1,
						updatedAt: ctx.now
					}
				}));
		}
	};
}
