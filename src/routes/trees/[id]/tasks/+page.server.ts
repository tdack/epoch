import { treeServerLoad } from '#lib/server/http/page-load.js';
import { TaskReadService } from '#lib/server/services/task-read-service.js';
import { parseQuery } from '#lib/server/validation/index.js';
import { taskListQuerySchema } from '#lib/server/validation/schemas.js';
import { parseListParams } from '#lib/shared/lists.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to list the tasks' },
	async ({ db, ctx, treeId }, { url }) => {
		const status = url.searchParams.get('status') ?? 'open';
		const isMine = url.searchParams.get('mine') === 'true';
		const subjectKind = url.searchParams.get('subjectKind') ?? '';
		const subjectId = url.searchParams.get('subjectId') ?? '';
		const linked = url.searchParams.get('linked') ?? '';
		// Validated as `GET /api/.../tasks` validated it: a hand-edited address is a 400, not a guess.
		const asked = new URLSearchParams({ status });
		if (isMine) asked.set('mine', 'true');
		if (linked) asked.set('linked', linked);
		if (subjectKind && subjectId) {
			asked.set('subjectKind', subjectKind);
			asked.set('subjectId', subjectId);
		}
		const query = parseQuery(taskListQuerySchema, asked);
		return {
			status,
			isMine,
			linked,
			subject: subjectKind && subjectId ? { kind: subjectKind, id: subjectId } : null,
			page: await new TaskReadService(db).listTasks(
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
		};
	}
);
