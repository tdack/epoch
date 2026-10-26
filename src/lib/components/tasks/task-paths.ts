import type { TaskDto } from '#lib/shared/tasks.js';

/** Where a task's record is under the tree's `base` path; null for a task about nothing. */
export function taskSubjectPath(base: string, task: TaskDto): string | null {
	const s = task.subject;
	if (s?.personId) return `${base}/people/${encodeURIComponent(s.personId)}`;
	if (s?.unionId) return `${base}/unions/${encodeURIComponent(s.unionId)}`;
	if (s?.sourceId) return `${base}/sources/${encodeURIComponent(s.sourceId)}`;
	if (s?.noteId) return `${base}/notes/${encodeURIComponent(s.noteId)}`;
	return null;
}
