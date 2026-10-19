import { treeHandler } from '#lib/server/http/handler.js';
import { TaskService } from '#lib/server/services/task-service.js';
import { taskCreateSchema } from '#lib/server/validation/schemas.js';

/** Make a task: a contributor may; it may be about one record and one quality finding, and given to a member. */
export const POST = treeHandler(
	{ failure: 'Failed to add the task', body: taskCreateSchema, status: 201 },
	async ({ db, ctx, treeId, body: { subject, findingKey, ...task } }) => {
		const { taskId, change } = await new TaskService(db).createTask(
			treeId,
			{ task, subject, findingKey },
			ctx
		);
		return { taskId, change };
	}
);
