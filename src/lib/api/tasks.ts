import type { ChangeSummary, ImpactSummary } from '#lib/types/genealogy.js';
import type { TaskInput, TaskPageDto, TaskSubjectRef } from '#lib/shared/tasks.js';
import { type Changed, call, enc, json } from './client.js';

export async function fetchTasks(
	treeId: string,
	params: URLSearchParams,
	fetcher: typeof fetch = fetch
): Promise<TaskPageDto> {
	return call(
		`/api/trees/${enc(treeId)}/tasks?${params}`,
		{ method: 'GET' },
		'Failed to list the tasks',
		fetcher
	);
}

export async function createTaskApi(
	treeId: string,
	task: TaskInput & { title: string },
	link: { subject?: TaskSubjectRef | null; findingKey?: string | null } = {}
): Promise<{ taskId: string; change: ChangeSummary | null }> {
	return call(
		`/api/trees/${enc(treeId)}/tasks`,
		json('POST', { ...task, subject: link.subject ?? null, findingKey: link.findingKey ?? null }),
		'Failed to add the task'
	);
}

export async function updateTaskApi(
	treeId: string,
	taskId: string,
	task: TaskInput,
	version: number
): Promise<Changed> {
	return call(
		`/api/trees/${enc(treeId)}/tasks/${enc(taskId)}`,
		json('PUT', { ...task, version }),
		'Failed to save the task'
	);
}

export async function deleteTaskApi(
	treeId: string,
	taskId: string,
	version: number
): Promise<Changed> {
	return call(
		`/api/trees/${enc(treeId)}/tasks/${enc(taskId)}?version=${version}`,
		{ method: 'DELETE' },
		'Failed to delete the task'
	);
}

export async function previewDeleteTaskApi(
	treeId: string,
	taskId: string,
	version: number
): Promise<ImpactSummary> {
	const data = await call<{ impact: ImpactSummary }>(
		`/api/trees/${enc(treeId)}/tasks/impact`,
		json('POST', { taskId, version }),
		'Failed to preview the change'
	);
	return data.impact;
}
