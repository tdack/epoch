<script lang="ts">
	import { Plus } from '@lucide/svelte';
	import type { ToastStore } from '#lib/components/feedback/toasts.svelte.js';
	import TaskDialog from '#lib/components/tasks/TaskDialog.svelte';
	import TaskList from '#lib/components/tasks/TaskList.svelte';
	import { canAddTask } from '#lib/components/tasks/task-permissions.js';
	import type { TreeEditor } from '#lib/components/tree/tree-editor.svelte.js';
	import type { PersonPageDto } from '#lib/shared/person-page.js';
	import type { TreeRole } from '#lib/shared/roles.js';
	import { TASK_SUBJECT_KINDS } from '#lib/shared/tasks.js';
	import { treePath } from '#lib/shared/tree-slug.js';

	interface Props {
		dto: PersonPageDto;
		treeId: string;
		/** The tree's slug, for the links this builds (ADR-045); without one they use the id. */
		treeSlug?: string | null;
		role: TreeRole | undefined;
		editor: TreeEditor;
		toasts: ToastStore;
	}

	let { dto, treeId, treeSlug = null, role, editor, toasts }: Props = $props();
	const treeRef = $derived({ id: treeId, slug: treeSlug });

	let isDialogOpen = $state(false);

	/** What a new task from here may be about: the person, or one of their facts. */
	const subjects = $derived([
		{
			ref: { kind: TASK_SUBJECT_KINDS.PERSON, id: dto.person.id },
			label: dto.person.displayName
		},
		...dto.facts.map((f) => ({
			ref: { kind: TASK_SUBJECT_KINDS.EVENT, id: f.id },
			label: `the ${f.label.toLowerCase()}${f.dateText ? ` (${f.dateText})` : ''}`
		}))
	]);

	const open = $derived(dto.tasks.items.filter((t) => t.status === 'open').length);
	const allHref = $derived(
		`${treePath(treeRef)}/tasks?status=all&subjectKind=person&subjectId=${encodeURIComponent(dto.person.id)}`
	);
</script>

<div class="flex items-center justify-between gap-3">
	<p class="text-xs text-stone-600" data-testid="tasks-summary">
		{dto.tasks.items.length === 0
			? 'No research task for this person.'
			: `${open} open of ${dto.tasks.items.length}.`}
	</p>
	{#if canAddTask(role)}
		<button
			type="button"
			class="action-btn"
			onclick={() => (isDialogOpen = true)}
			aria-label={`Add a task about ${dto.person.displayName}`}
			><Plus class="h-3.5 w-3.5" />Add task</button
		>
	{/if}
</div>
{#if dto.tasks.items.length > 0}
	<div class="mt-2">
		<TaskList
			{treeId}
			{treeSlug}
			{role}
			tasks={dto.tasks.items}
			members={dto.tasks.members}
			{editor}
			{toasts}
		/>
		<p class="mt-2 text-xs">
			<a href={allHref} class="text-link">All tasks about this person</a>
		</p>
	</div>
{/if}

<TaskDialog
	isOpen={isDialogOpen}
	{treeId}
	task={null}
	{subjects}
	members={dto.tasks.members}
	onsaved={async (change) => {
		isDialogOpen = false;
		await editor.afterChange(change, 'Task added');
	}}
	onstale={async () => {
		isDialogOpen = false;
		await editor.refresh();
	}}
	oncancel={() => (isDialogOpen = false)}
/>
