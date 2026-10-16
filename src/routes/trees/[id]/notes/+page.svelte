<script lang="ts">
	import { goto } from '$app/navigation';
	import { Plus } from '@lucide/svelte';
	import Pager from '#lib/components/lists/Pager.svelte';
	import SharedNoteDialog from '#lib/components/notes/SharedNoteDialog.svelte';
	import { canAddNote } from '#lib/components/notes/note-permissions.js';
	import { getTreeContext } from '#lib/components/tree/tree-context.js';
	import type { PageProps } from './$types';
	import { treePath } from '#lib/shared/tree-slug.js';

	let { data }: PageProps = $props();
	const { editor } = getTreeContext();

	const treeId = $derived(data.summary.tree.id);
	const base = $derived(treePath(data.summary.tree));
	const role = $derived(data.trees.find((t) => t.id === treeId)?.role);
	const page = $derived(data.page);
	const pageHref = (offset: number) => {
		const params = new URLSearchParams();
		if (data.q) params.set('q', data.q);
		if (offset > 0) params.set('offset', String(offset));
		return `${base}/notes${params.size > 0 ? `?${params}` : ''}`;
	};

	let isDialogOpen = $state(false);
</script>

<svelte:head>
	<title>Notes · {data.summary.tree.name} · Epoch</title>
</svelte:head>

<header class="flex flex-wrap items-start justify-between gap-3">
	<div>
		<h2 class="text-2xl font-bold text-stone-900">Shared notes</h2>
		<p class="mt-1 max-w-2xl text-sm text-stone-600">
			Notes that more than one record uses. Open one to see every record it is on. A note written on
			a single record is on that record's page.
		</p>
	</div>
	{#if canAddNote(role)}
		<button type="button" class="action-btn" onclick={() => (isDialogOpen = true)}
			><Plus class="h-3.5 w-3.5" />Add shared note</button
		>
	{/if}
</header>

<form method="get" class="mt-4 flex items-end gap-2" role="search">
	<div>
		<label for="note-filter" class="block text-xs font-semibold text-stone-700">Find a note</label>
		<input
			id="note-filter"
			name="q"
			type="search"
			value={data.q}
			autocomplete="off"
			class="mt-1 w-64 rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
			placeholder="Words in the note"
		/>
	</div>
	<button type="submit" class="btn-primary">Find</button>
</form>

<div class="mt-4">
	{#if page.items.length === 0}
		<p class="text-sm text-stone-700" data-testid="no-notes">
			{data.q ? 'No shared note matches.' : 'No shared notes recorded.'}
		</p>
	{:else}
		<ul
			class="divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white"
			data-testid="notes-list"
		>
			{#each page.items as item (item.id)}
				<li class="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2 text-sm">
					<a
						href={`${base}/notes/${encodeURIComponent(item.id)}`}
						class="font-semibold text-emerald-900 hover:underline">{item.title}</a
					>
					<span class="text-stone-600"
						>{item.useCount} {item.useCount === 1 ? 'record' : 'records'}</span
					>
				</li>
			{/each}
		</ul>
		<Pager
			summary="Showing {page.offset + 1} to {page.offset + page.items.length}"
			previousHref={page.offset > 0 ? pageHref(Math.max(0, page.offset - page.limit)) : null}
			nextHref={page.hasMore ? pageHref(page.offset + page.limit) : null}
		/>
	{/if}
</div>

<SharedNoteDialog
	isOpen={isDialogOpen}
	{treeId}
	note={null}
	onsaved={async (change, noteId) => {
		isDialogOpen = false;
		await editor.afterChange(change, 'Note added');
		await goto(`${base}/notes/${encodeURIComponent(noteId)}`);
	}}
	onstale={async () => {
		isDialogOpen = false;
		await editor.refresh();
	}}
	oncancel={() => (isDialogOpen = false)}
/>
