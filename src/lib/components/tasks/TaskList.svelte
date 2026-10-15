<script lang="ts">
	import { CircleCheck, CircleDashed, CircleSlash } from '@lucide/svelte';
	import type { ToastStore } from '#lib/components/feedback/toasts.svelte.js';
	import type { TreeEditor } from '#lib/components/tree/tree-editor.svelte.js';
	import { deleteTaskApi, previewDeleteTaskApi, updateTaskApi } from '#lib/api/tree-api.js';
	import type { TreeRole } from '#lib/shared/roles.js';
	import {
		TASK_STATUS_LABELS,
		TASK_STATUSES,
		isOverdue,
		type TaskDto,
		type TaskStatus
	} from '#lib/shared/tasks.js';
	import TaskDialog from './TaskDialog.svelte';
	import { canDeleteTask } from './task-permissions.js';
	import { treePath } from '#lib/shared/tree-slug.js';

	interface Props {
		treeId: string;
		/** The tree's slug, for the links this builds (ADR-045); without one they use the id. */
		treeSlug?: string | null;
		role: TreeRole | undefined;
		tasks: TaskDto[];
		/** Current members of the tree, for the edit dialog's assignee choice. */
		members: Array<{ id: string; name: string }>;
		editor: TreeEditor;
		toasts: ToastStore;
		/** Show where each task points; off where the page is already about that record. */
		shouldShowSubject?: boolean;
		/** Today's date as `YYYY-MM-DD`, for overdue marking; defaults to the browser's. */
		today?: string;
	}

	let {
		treeId,
		treeSlug = null,
		role,
		tasks,
		members,
		editor,
		toasts,
		shouldShowSubject = true,
		today = new Date().toISOString().slice(0, 10)
	}: Props = $props();
	const treeRef = $derived({ id: treeId, slug: treeSlug });

	let dialog = $state<{ task: TaskDto } | null>(null);
	const base = $derived(treePath(treeRef));

	const hrefOf = (task: TaskDto) => {
		const s = task.subject;
		if (!s) return null;
		if (s.personId) return `${base}/people/${encodeURIComponent(s.personId)}`;
		if (s.unionId) return `${base}/unions/${encodeURIComponent(s.unionId)}`;
		if (s.sourceId) return `${base}/sources/${encodeURIComponent(s.sourceId)}`;
		if (s.noteId) return `${base}/notes/${encodeURIComponent(s.noteId)}`;
		return null;
	};

	const KIND_WORDS = {
		person: 'person',
		union: 'partnership',
		event: 'fact',
		source: 'source',
		note: 'note'
	} as const;

	async function setStatus(task: TaskDto, status: TaskStatus, done: string) {
		await editor.mutate(() => updateTaskApi(treeId, task.id, { status }, task.version), {
			done,
			failure: 'Could not change the task'
		});
	}

	function remove(task: TaskDto) {
		void editor.confirmWithImpact({
			title: `Delete the task “${task.title}”?`,
			confirmLabel: 'Delete task',
			preview: () => previewDeleteTaskApi(treeId, task.id, task.version),
			run: () => deleteTaskApi(treeId, task.id, task.version),
			done: 'Task deleted'
		});
	}
</script>

{#if tasks.length === 0}
	<p class="text-xs text-stone-600 italic" data-testid="no-tasks">No task to show.</p>
{:else}
	<ul class="space-y-2" data-testid="tasks">
		{#each tasks as task (task.id)}
			<li
				id={`task-${task.id}`}
				class="rounded-lg border border-stone-200 bg-white p-2 text-sm"
				data-testid="task"
				data-status={task.status}
			>
				<div class="flex flex-wrap items-baseline justify-between gap-2">
					<span
						class="font-semibold text-stone-900 {task.status !== 'open' ? 'text-stone-600' : ''}"
						>{task.title}</span
					>
					<span
						class="inline-flex items-center gap-1 text-xs font-semibold {task.status === 'done'
							? 'text-emerald-800'
							: task.status === 'dropped'
								? 'text-stone-500'
								: 'text-stone-700'}"
						data-testid="task-status"
					>
						{#if task.status === TASK_STATUSES.DONE}<CircleCheck
								class="h-3.5 w-3.5"
								aria-hidden="true"
							/>
						{:else if task.status === TASK_STATUSES.DROPPED}<CircleSlash
								class="h-3.5 w-3.5"
								aria-hidden="true"
							/>
						{:else}<CircleDashed class="h-3.5 w-3.5" aria-hidden="true" />{/if}
						{TASK_STATUS_LABELS[task.status]}
					</span>
				</div>
				{#if task.details}<p class="mt-1 text-xs whitespace-pre-line text-stone-700">
						{task.details}
					</p>{/if}
				<p class="mt-1 flex flex-wrap gap-x-3 text-xs text-stone-600">
					{#if task.assignee}<span data-testid="task-assignee"
							>Assigned to {task.assignee.name}</span
						>{/if}
					{#if task.dueDate}<span
							class={isOverdue(task, today) ? 'font-semibold text-red-700' : ''}
							data-testid="task-due"
							>Due {task.dueDate}{#if isOverdue(task, today)}
								(overdue){/if}</span
						>{/if}
					{#if shouldShowSubject && task.subject}
						<span
							>About
							{#if hrefOf(task)}<a href={hrefOf(task)} class="text-link">{task.subject.label}</a
								>{:else}{task.subject.label}{/if}</span
						>
					{/if}
				</p>
				{#if task.clearedLinkKind}
					<p class="mt-1 text-xs text-stone-500 italic" data-testid="task-cleared">
						The {KIND_WORDS[task.clearedLinkKind]} this task was about has been deleted.
					</p>
				{/if}
				{#if task.canEdit}
					<div class="mt-1.5 flex flex-wrap items-center gap-3 text-xs font-semibold">
						{#if task.status === TASK_STATUSES.OPEN}
							<button
								type="button"
								class="row-link"
								onclick={() => void setStatus(task, 'done', 'Task completed')}
								aria-label={`Complete the task ${task.title}`}>Complete</button
							>
							<button
								type="button"
								class="row-link"
								onclick={() => void setStatus(task, 'dropped', 'Task dropped')}
								aria-label={`Drop the task ${task.title}`}>Drop</button
							>
						{:else}
							<button
								type="button"
								class="row-link"
								onclick={() => void setStatus(task, 'open', 'Task reopened')}
								aria-label={`Reopen the task ${task.title}`}>Reopen</button
							>
						{/if}
						<button
							type="button"
							class="row-link"
							onclick={() => (dialog = { task })}
							aria-label={`Edit the task ${task.title}`}>Edit</button
						>
						{#if canDeleteTask(role)}
							<button
								type="button"
								class="row-link text-red-700"
								onclick={() => remove(task)}
								aria-label={`Delete the task ${task.title}`}>Delete</button
							>
						{/if}
					</div>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

<TaskDialog
	isOpen={dialog !== null}
	{treeId}
	task={dialog?.task ?? null}
	{members}
	onsaved={async (change) => {
		dialog = null;
		await editor.afterChange(change, 'Task saved');
	}}
	onstale={async (message) => {
		dialog = null;
		await editor.refresh();
		toasts.push(`${message} Review the task and try again.`, { tone: 'error', durationMs: 10_000 });
	}}
	oncancel={() => (dialog = null)}
/>
