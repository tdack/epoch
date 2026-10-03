/**
 * Writes research tasks through the mutation runner, so every change is previewed, logged and
 * undoable like any other (ADR-029). Reads for the tasks page, the person page and the quality
 * report live in `task-read-service.ts`.
 *
 * Who may do what: a contributor makes tasks and edits the ones they made; an editor or above
 * edits any task and deletes. The assignee must be a current member of the tree, so a task is never
 * given to someone who cannot see it.
 */

import type { DbClient } from '../db';
import type { TreeAction } from '../auth/authorization';
import { describeCommand } from '../domain/command-summary';
import type { TreeRows } from '../domain/change-log';
import { ValidationError } from '../domain/errors';
import type { AuthenticatedContext } from '../domain/identity';
import { requireTask, type TaskCommand } from '../domain/task-ops';
import { MemberRepository } from '../repositories/member-repository';
import type { TaskInput, TaskSubjectRef } from '../../shared/tasks';
import { MutationRunner, type MutationClock, type MutationResult } from './mutation-runner';

export class TaskService {
	readonly runner: MutationRunner;
	private members: MemberRepository;

	constructor(db: DbClient, clock?: MutationClock) {
		this.runner = new MutationRunner(db, clock);
		this.members = new MemberRepository(db);
	}

	/** Throws unless the user is a member of this tree: a task is only ever given to someone who can see it. */
	private async requireMember(treeId: string, userId: string | null | undefined): Promise<void> {
		if (userId === null || userId === undefined) return;
		if (!(await this.members.getMember(treeId, userId)))
			throw new ValidationError('A task can only be given to a member of this tree.');
	}

	private async run(
		treeId: string,
		command: TaskCommand,
		context: AuthenticatedContext,
		requiredAction: (rows: TreeRows) => TreeAction
	): Promise<MutationResult> {
		// The weakest right any task change needs, before anything is planned, so a role that can
		// change nothing is refused without being told whether a task exists.
		await this.runner.requireAccess(treeId, context, 'record:create');
		return this.runner.run(treeId, context, {
			kind: command.kind,
			summary: (rows) => describeCommand(command, rows),
			commands: [command],
			requiredAction
		});
	}

	async createTask(
		treeId: string,
		input: {
			task: TaskInput & { title: string };
			subject?: TaskSubjectRef | null;
			findingKey?: string | null;
		},
		context: AuthenticatedContext
	): Promise<{ taskId: string } & MutationResult> {
		await this.runner.requireAccess(treeId, context, 'record:create');
		await this.requireMember(treeId, input.task.assigneeId);
		const taskId = this.runner.clock.newId();
		const result = await this.run(
			treeId,
			{ kind: 'create_task', taskId, ...input },
			context,
			() => 'record:create'
		);
		return { taskId, ...result };
	}

	async updateTask(
		treeId: string,
		taskId: string,
		task: TaskInput,
		expectedVersion: number | undefined,
		context: AuthenticatedContext
	): Promise<MutationResult> {
		await this.runner.requireAccess(treeId, context, 'record:create');
		await this.requireMember(treeId, task.assigneeId);
		return this.run(
			treeId,
			{ kind: 'update_task', taskId, expectedVersion, task },
			context,
			// A contributor edits only what they made; anyone above them edits any task.
			(rows) =>
				requireTask(rows, taskId).createdBy === context.user.id ? 'record:create' : 'record:edit'
		);
	}

	async deleteTask(
		treeId: string,
		taskId: string,
		expectedVersion: number | undefined,
		context: AuthenticatedContext
	): Promise<MutationResult> {
		await this.runner.requireAccess(treeId, context, 'record:create');
		return this.run(
			treeId,
			{ kind: 'delete_task', taskId, expectedVersion },
			context,
			() => 'record:delete'
		);
	}
}
