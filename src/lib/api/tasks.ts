import type { ImpactResponse } from '#lib/shared/api-contracts.js';
import type { ChangeSummary, ImpactSummary } from '#lib/types/genealogy.js';
import type { TaskInput, TaskPageDto, TaskSubjectRef } from '#lib/shared/tasks.js';
import { type Changed, call, json, path } from './client.js';

export async function fetchTasks(
	treeId: string,
	params: URLSearchParams,
	fetcher: typeof fetch = fetch
): Promise<TaskPageDto> {
	return call(
		path`/api/trees/${treeId}/tasks` + `?${params}`,
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
		path`/api/trees/${treeId}/tasks`,
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
		path`/api/trees/${treeId}/tasks/${taskId}`,
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
		path`/api/trees/${treeId}/tasks/${taskId}` + `?version=${version}`,
		{ method: 'DELETE' },
		'Failed to delete the task'
	);
}

export async function previewDeleteTaskApi(
	treeId: string,
	taskId: string,
	version: number
): Promise<ImpactSummary> {
	const data = await call<ImpactResponse>(
		path`/api/trees/${treeId}/tasks/impact`,
		json('POST', { taskId, version }),
		'Failed to preview the change'
	);
	return data.impact;
}
