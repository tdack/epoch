import { treeHandler } from '#lib/server/http/handler.js';
import { TaskReadService } from '#lib/server/services/task-read-service.js';
import { TaskService } from '#lib/server/services/task-service.js';
import { taskCreateSchema, taskListQuerySchema } from '#lib/server/validation/schemas.js';
import { parseListParams } from '#lib/shared/lists.js';

/**
 * A page of research tasks the viewer may see, open ones unless `?status=` says otherwise
 * (`open`, `done`, `dropped` or `all`), with `?mine=true` for their own and `?subjectKind=&subjectId=`
 * for those about one record, and `?linked=` (a kind of record, or `none`) for those about a kind of record. A task about a record they cannot see is not listed, title included.
 */
export const GET = treeHandler(
	{ failure: 'Failed to list the tasks', query: taskListQuerySchema },
	({ db, ctx, treeId, url, query }) =>
		new TaskReadService(db).listTasks(
			treeId,
			{
				...parseListParams(url.searchParams),
				status: query.status,
				isMine: query.mine === 'true',
				subject:
					query.subjectKind && query.subjectId
						? { kind: query.subjectKind, id: query.subjectId }
						: null,
				linked: query.linked ?? null
			},
			ctx
		)
);

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
