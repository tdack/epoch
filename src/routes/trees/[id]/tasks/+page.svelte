<script lang="ts">
	import { treeLinkSlug } from '#lib/shared/tree-slug.js';
	import { Plus } from '@lucide/svelte';
	import Pager from '#lib/components/lists/Pager.svelte';
	import TaskDialog from '#lib/components/tasks/TaskDialog.svelte';
	import TaskList from '#lib/components/tasks/TaskList.svelte';
	import { canAddTask } from '#lib/components/tasks/task-permissions.js';
	import { getTreeContext } from '#lib/components/tree/tree-context.js';
	import {
		TASK_STATUS_LABELS,
		TASK_STATUS_VALUES,
		TASK_SUBJECT_KIND_VALUES
	} from '#lib/shared/tasks.js';
	import type { PageProps } from './$types';
	import { treePath } from '#lib/shared/tree-slug.js';

	let { data }: PageProps = $props();
	const { editor, toasts } = getTreeContext();

	const treeId = $derived(data.summary.tree.id);
	const base = $derived(treePath(data.summary.tree));
	const role = $derived(data.trees.find((t) => t.id === treeId)?.role);
	const page = $derived(data.page);

	/** The page's own address with some filters changed; the offset always starts again. */
	function href(changes: Record<string, string | null>, offset = 0) {
		const params = new URLSearchParams();
		const current: Record<string, string | null> = {
			status: data.status === 'open' ? null : data.status,
			mine: data.isMine ? 'true' : null,
			linked: data.linked || null,
			subjectKind: data.subject?.kind ?? null,
			subjectId: data.subject?.id ?? null,
			...changes
		};
		for (const [key, value] of Object.entries(current)) if (value) params.set(key, value);
		if (offset > 0) params.set('offset', String(offset));
		return `${base}/tasks${params.size > 0 ? `?${params}` : ''}`;
	}

	const KIND_FILTERS = {
		none: 'Not linked to a record',
		person: 'About a person',
		union: 'About a partnership',
		event: 'About a fact',
		source: 'About a source',
		note: 'About a shared note'
	} as const;

	let isDialogOpen = $state(false);
	const subjectLabel = $derived(
		page.items.find((t) => t.subject?.id === data.subject?.id)?.subject?.label
	);
</script>

<svelte:head>
	<title>Tasks · {data.summary.tree.name} · Epoch</title>
</svelte:head>

<header class="flex flex-wrap items-start justify-between gap-3">
	<div>
		<h1 class="text-2xl font-bold text-stone-900">Research tasks</h1>
		<p class="mt-1 max-w-2xl text-sm text-stone-600">
			Things still to find out or check, on a person, a fact, a partnership, a source or a quality
			finding. Tasks are for working in Epoch; they are not part of an exported file.
		</p>
	</div>
	{#if canAddTask(role)}
		<button type="button" class="action-btn" onclick={() => (isDialogOpen = true)}
			><Plus class="h-3.5 w-3.5" />Add task</button
		>
	{/if}
</header>

<nav aria-label="Task status" class="mt-4 flex flex-wrap items-center gap-1 text-sm">
	{#each [...TASK_STATUS_VALUES, 'all' as const] as status (status)}
		<a
			href={href({ status: status === 'open' ? null : status })}
			aria-current={data.status === status ? 'page' : undefined}
			class="rounded-lg px-3 py-1.5 font-semibold {data.status === status
				? 'bg-emerald-800 text-white'
				: 'text-stone-700 hover:bg-stone-200'}"
			data-testid={`task-tab-${status}`}
		>
			{status === 'all' ? 'All' : TASK_STATUS_LABELS[status]}
			{#if status !== 'all'}<span class="font-normal">({page.counts[status]})</span>{/if}
		</a>
	{/each}
</nav>

<form method="get" class="mt-3 flex flex-wrap items-end gap-3" role="search">
	{#if data.status !== 'open'}<input type="hidden" name="status" value={data.status} />{/if}
	<label class="flex items-center gap-2 text-sm font-semibold text-stone-700">
		<input type="checkbox" name="mine" value="true" checked={data.isMine} />
		Assigned to me
	</label>
	<div>
		<label for="task-linked" class="block text-xs font-semibold text-stone-700">Linked record</label
		>
		<select
			id="task-linked"
			name="linked"
			class="mt-1 rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
		>
			<option value="" selected={!data.linked}>Anything</option>
			{#each ['none', ...TASK_SUBJECT_KIND_VALUES] as kind (kind)}
				<option value={kind} selected={data.linked === kind}
					>{KIND_FILTERS[kind as keyof typeof KIND_FILTERS]}</option
				>
			{/each}
		</select>
	</div>
	<button type="submit" class="btn-primary">Filter</button>
	{#if data.subject}
		<p class="text-sm text-stone-700" data-testid="task-subject-filter">
			About {subjectLabel ?? 'one record'} ·
			<a href={href({ subjectKind: null, subjectId: null })} class="text-link">Show all</a>
		</p>
	{/if}
</form>

<div class="mt-4">
	{#if page.items.length === 0}
		<p class="text-sm text-stone-700" data-testid="no-tasks-page">
			{data.status === 'open' ? 'No open task.' : 'No task matches.'}
		</p>
	{:else}
		<TaskList
			{treeId}
			treeSlug={treeLinkSlug(data.summary.tree)}
			{role}
			tasks={page.items}
			members={page.members}
			{editor}
			{toasts}
		/>
		<Pager
			summary="Showing {page.offset + 1} to {page.offset + page.items.length}"
			previousHref={page.offset > 0 ? href({}, Math.max(0, page.offset - page.limit)) : null}
			nextHref={page.hasMore ? href({}, page.offset + page.limit) : null}
		/>
	{/if}
</div>

<TaskDialog
	isOpen={isDialogOpen}
	{treeId}
	task={null}
	members={page.members}
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
