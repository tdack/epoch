import { listQuery, treeLoad } from '#lib/api/load-helpers.js';
import { fetchTasks } from '#lib/api/tasks.js';
import type { PageLoad } from './$types';

export const load: PageLoad = treeLoad(async ({ params, url, fetch }) => {
	const status = url.searchParams.get('status') ?? 'open';
	const isMine = url.searchParams.get('mine') === 'true';
	const subjectKind = url.searchParams.get('subjectKind') ?? '';
	const subjectId = url.searchParams.get('subjectId') ?? '';
	const linked = url.searchParams.get('linked') ?? '';
	const query = listQuery(url, { status });
	if (isMine) query.set('mine', 'true');
	if (linked) query.set('linked', linked);
	if (subjectKind && subjectId) {
		query.set('subjectKind', subjectKind);
		query.set('subjectId', subjectId);
	}
	return {
		status,
		isMine,
		linked,
		subject: subjectKind && subjectId ? { kind: subjectKind, id: subjectId } : null,
		page: await fetchTasks(params.id, query, fetch)
	};
});
