import { expectedVersion, treeHandler } from '#lib/server/http/handler.js';
import { TaskReadService } from '#lib/server/services/task-read-service.js';
import { TaskService } from '#lib/server/services/task-service.js';
import { taskUpdateSchema } from '#lib/server/validation/schemas.js';

/** One task. A task about a record the viewer may not see answers 404, as a private person does. */
export const GET = treeHandler(
	{ failure: 'Failed to load the task', params: ['taskId'] },
	({ db, ctx, treeId, params }) => new TaskReadService(db).getTask(treeId, params.taskId, ctx)
);

/**
 * Edit a task, or complete, drop or reopen it by setting its status. A contributor edits the tasks
 * they made; an editor or above edits any.
 */
export const PUT = treeHandler(
	{ failure: 'Failed to save the task', params: ['taskId'], body: taskUpdateSchema },
	async ({ db, ctx, treeId, params, body: { version, ...task } }) => {
		const { change } = await new TaskService(db).updateTask(
			treeId,
			params.taskId,
			task,
			version,
			ctx
		);
		return { change };
	}
);

/** Delete a task: an editor or above. A task nobody needs is better dropped, which keeps the record of it. */
export const DELETE = treeHandler(
	{ failure: 'Failed to delete the task', params: ['taskId'] },
	async ({ db, ctx, treeId, params, url }) => {
		const { change } = await new TaskService(db).deleteTask(
			treeId,
			params.taskId,
			expectedVersion(url),
			ctx
		);
		return { change };
	}
);
