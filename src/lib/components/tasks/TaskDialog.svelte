<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { ListTodo } from '@lucide/svelte';
	import BaseModal from '#lib/components/modals/BaseModal.svelte';
	import { createSubmission } from '#lib/components/forms/submission.svelte.js';
	import { createTaskApi, updateTaskApi } from '#lib/api/tasks.js';
	import {
		MAX_TASK_DETAILS_LENGTH,
		MAX_TASK_TITLE_LENGTH,
		TASK_STATUS_LABELS,
		TASK_STATUS_VALUES,
		isDueDate,
		type TaskDto,
		type TaskStatus,
		type TaskSubjectRef
	} from '#lib/shared/tasks.js';
	import type { ChangeSummary } from '#lib/types/genealogy.js';

	interface Props {
		isOpen: boolean;
		treeId: string;
		/** The task being edited, or null to make one. */
		task: TaskDto | null;
		/** The record a new task is about, with its name for the subtitle; null for an unlinked task. */
		subject?: { ref: TaskSubjectRef; label: string } | null;
		/** Records a new task may be about, to choose from (a person and their facts); wins over `subject`. */
		subjects?: Array<{ ref: TaskSubjectRef; label: string }>;
		/** The quality finding a new task is made from, by the report's key. */
		findingKey?: string | null;
		/** A title to start from, such as a finding's message. */
		suggestedTitle?: string;
		/** Current members of the tree, for the assignee choice. */
		members: Array<{ id: string; name: string }>;
		/** Called after a save, with the change so the caller can offer Undo. */
		onsaved: (change: ChangeSummary | null) => void | Promise<void>;
		/** Called when the task changed under the editor; the caller reloads. */
		onstale: (message: string) => void | Promise<void>;
		oncancel: () => void;
	}

	let {
		isOpen,
		treeId,
		task,
		subject = null,
		subjects = [],
		findingKey = null,
		suggestedTitle = '',
		members,
		onsaved,
		onstale,
		oncancel
	}: Props = $props();

	let title = $state('');
	let details = $state('');
	let status = $state<TaskStatus>('open');
	let assigneeId = $state('');
	let dueDate = $state('');
	let chosen = $state(0);
	const submission = createSubmission((message) => onstale(message));
	let titleInput = $state<HTMLInputElement | null>(null);

	const field =
		'w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600';

	// Filled when the dialog opens only, so a reload underneath does not wipe what has been typed.
	$effect(() => {
		if (!isOpen) return;
		const from = untrack(() => task);
		title = from?.title ?? untrack(() => suggestedTitle);
		details = from?.details ?? '';
		status = from?.status ?? 'open';
		assigneeId = from?.assignee?.id ?? '';
		dueDate = from?.dueDate ?? '';
		chosen = 0;
		submission.error = null;
		void tick().then(() => titleInput?.focus());
	});

	const about = $derived(subjects.length > 0 ? subjects[chosen] : subject);

	async function save() {
		const words = title.trim();
		if (!words) {
			submission.error = 'A task needs a title.';
			return;
		}
		if (dueDate && !isDueDate(dueDate)) {
			submission.error = 'Choose a due date from the calendar.';
			return;
		}
		const input = {
			title: words,
			details: details.trim() || null,
			assigneeId: assigneeId || null,
			dueDate: dueDate || null
		};
		await submission.submit(async () => {
			const { change } = task
				? await updateTaskApi(treeId, task.id, { ...input, status }, task.version)
				: await createTaskApi(treeId, input, { subject: about?.ref ?? null, findingKey });
			await onsaved(change);
		}, 'Could not save the task');
	}
</script>

<BaseModal
	{isOpen}
	title={task ? 'Edit task' : 'Add a research task'}
	subtitle={task ? undefined : subject ? `About ${subject.label}` : 'Not linked to a record'}
	icon={ListTodo}
	maxWidthClass="max-w-lg"
	error={submission.error}
	onclose={oncancel}
>
	<form
		class="space-y-3"
		data-testid="task-form"
		onsubmit={(event) => {
			event.preventDefault();
			void save();
		}}
	>
		<div>
			<label for="task-title" class="field-label">What needs doing</label>
			<input
				id="task-title"
				type="text"
				maxlength={MAX_TASK_TITLE_LENGTH}
				bind:this={titleInput}
				bind:value={title}
				class={field}
				data-testid="task-title"
			/>
		</div>
		<div>
			<label for="task-details" class="field-label"
				>Details <span class="font-normal text-stone-500">(optional)</span></label
			>
			<textarea
				id="task-details"
				rows="3"
				maxlength={MAX_TASK_DETAILS_LENGTH}
				bind:value={details}
				class={field}></textarea>
		</div>
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label for="task-assignee" class="field-label">Assigned to</label>
				<select id="task-assignee" bind:value={assigneeId} class={field}>
					<option value="">Nobody</option>
					{#each members as member (member.id)}
						<option value={member.id}>{member.name}</option>
					{/each}
				</select>
			</div>
			<div>
				<label for="task-due" class="field-label"
					>Due <span class="font-normal text-stone-500">(optional)</span></label
				>
				<input id="task-due" type="date" bind:value={dueDate} class={field} />
			</div>
		</div>
		{#if !task && subjects.length > 1}
			<div>
				<label for="task-about" class="field-label">About</label>
				<select id="task-about" bind:value={chosen} class={field}>
					{#each subjects as choice, index (choice.ref.kind + choice.ref.id)}
						<option value={index}>{choice.label}</option>
					{/each}
				</select>
			</div>
		{/if}
		{#if task}
			<div>
				<label for="task-status" class="field-label">Status</label>
				<select id="task-status" bind:value={status} class={field}>
					{#each TASK_STATUS_VALUES as value (value)}
						<option {value}>{TASK_STATUS_LABELS[value]}</option>
					{/each}
				</select>
			</div>
		{/if}
		<div class="flex gap-2 pt-1">
			<button
				type="button"
				onclick={oncancel}
				class="flex-1 cursor-pointer rounded-lg bg-stone-200 py-2 font-semibold text-stone-700 hover:bg-stone-300"
				>Cancel</button
			>
			<button
				type="submit"
				disabled={submission.isSaving || !title.trim()}
				class="btn-primary flex-1"
				>{submission.isSaving ? 'Saving…' : task ? 'Save task' : 'Add task'}</button
			>
		</div>
	</form>
</BaseModal>
