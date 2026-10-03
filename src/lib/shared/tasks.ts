/**
 * The vocabulary of research tasks (ADR-029), shared by the server and the screens. A task is
 * Epoch's own data: there is no standard GEDCOM home for one, so tasks are never exported, and a
 * `_TODO` or similar tag a file carries stays retained as it always has.
 */

import type { PrivacyFlag } from './privacy';

export const TASK_STATUSES = { OPEN: 'open', DONE: 'done', DROPPED: 'dropped' } as const;
export type TaskStatus = (typeof TASK_STATUSES)[keyof typeof TASK_STATUSES];
export const TASK_STATUS_VALUES = [
	TASK_STATUSES.OPEN,
	TASK_STATUSES.DONE,
	TASK_STATUSES.DROPPED
] as const;

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
	open: 'Open',
	done: 'Done',
	dropped: 'Dropped'
};

export function isTaskStatus(value: unknown): value is TaskStatus {
	return value === 'open' || value === 'done' || value === 'dropped';
}

/** What a task can be about: one record. A task about a record keeps to the people it is about. */
export const TASK_SUBJECT_KINDS = {
	PERSON: 'person',
	UNION: 'union',
	EVENT: 'event',
	SOURCE: 'source',
	NOTE: 'note'
} as const;
export type TaskSubjectKind = (typeof TASK_SUBJECT_KINDS)[keyof typeof TASK_SUBJECT_KINDS];
export const TASK_SUBJECT_KIND_VALUES = [
	TASK_SUBJECT_KINDS.PERSON,
	TASK_SUBJECT_KINDS.UNION,
	TASK_SUBJECT_KINDS.EVENT,
	TASK_SUBJECT_KINDS.SOURCE,
	TASK_SUBJECT_KINDS.NOTE
] as const;

export interface TaskSubjectRef {
	kind: TaskSubjectKind;
	id: string;
}

/** What a task is made and edited with. A missing field on an edit is left as it is. */
export interface TaskInput {
	title?: string;
	details?: string | null;
	status?: TaskStatus;
	/** A member of the tree; null leaves the task unassigned. */
	assigneeId?: string | null;
	/** A calendar date, `YYYY-MM-DD`; null for none. */
	dueDate?: string | null;
}

/** The most a task title and its details may hold. */
export const MAX_TASK_TITLE_LENGTH = 200;
export const MAX_TASK_DETAILS_LENGTH = 5000;

/** The most a tasks page lists in one response. */
export const MAX_TASK_PAGE_SIZE = 100;
export const DEFAULT_TASK_PAGE_SIZE = 25;

/** A calendar date as the due-date field holds it. */
export const isDueDate = (value: unknown): value is string => {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

/** Whether an open task's due date has passed, given today's date as `YYYY-MM-DD`. */
export const isOverdue = (
	task: { status: TaskStatus; dueDate: string | null },
	today: string
): boolean => task.status === TASK_STATUSES.OPEN && task.dueDate !== null && task.dueDate < today;

// ---- What the pages read ----

export interface TaskDto extends PrivacyFlag {
	id: string;
	/** Send this back when editing; a newer stored version is a conflict. */
	version: number;
	title: string;
	details: string | null;
	status: TaskStatus;
	/** A current member of the tree, or null (unassigned, or the member has left). */
	assignee: { id: string; name: string } | null;
	dueDate: string | null;
	/** The record it is about, named and linked; null for an unlinked task. */
	subject: {
		kind: TaskSubjectKind;
		id: string;
		/** "Ann Ash", "the birth of Ann Ash", "the partnership of Ann Ash and Bob Ash". */
		label: string;
		personId: string | null;
		unionId: string | null;
		sourceId: string | null;
		noteId: string | null;
	} | null;
	/** The quality finding it was made from, by the key the report and dismissals use. */
	findingKey: string | null;
	/**
	 * Set when the record the task was about has been deleted: what kind it was. The task is kept
	 * with its link cleared, and says so.
	 */
	clearedLinkKind: TaskSubjectKind | null;
	createdBy: string | null;
	createdByName: string | null;
	/** Epoch milliseconds. */
	createdAt: number | null;
	updatedAt: number | null;
}

export interface TaskListQuery {
	/** Which statuses to list; the page defaults to open ones. */
	status: TaskStatus | 'all';
	/** Only tasks assigned to the viewer. */
	isMine: boolean;
	/** Only tasks about this record. */
	subject: TaskSubjectRef | null;
	offset: number;
	limit: number;
}

/** A page of tasks, and the people who may be assigned one. */
export interface TaskPageDto {
	items: TaskDto[];
	hasMore: boolean;
	offset: number;
	limit: number;
	/** Open, done and dropped counts across what the viewer may see, for the filter tabs. */
	counts: Record<TaskStatus, number>;
	/** Current members of the tree, for the assignee choice. */
	members: Array<{ id: string; name: string }>;
}

/** The task the quality report points at for a finding: enough to say so and link to it. */
export interface FindingTaskDto {
	id: string;
	title: string;
	status: TaskStatus;
}

/** The person page's tasks: those about the person, their facts and names, and the members who can take one. */
export interface PersonTasksDto {
	items: TaskDto[];
	members: Array<{ id: string; name: string }>;
}
