import { treeHandler } from '#lib/server/http/handler.js';
import { TaskService } from '#lib/server/services/task-service.js';
import { taskImpactSchema } from '#lib/server/validation/schemas.js';

/** Preview deleting a task: which records it would change. Saves nothing. */
export const POST = treeHandler(
	{ failure: 'Failed to preview the change', body: taskImpactSchema },
	async ({ db, ctx, treeId, body }) => ({
		impact: await new TaskService(db).previewDelete(treeId, body.taskId, body.version, ctx)
	})
);
