<script lang="ts">
	import { goto } from '$app/navigation';
	import { GitMerge, Pencil, Plus } from '@lucide/svelte';
	import { canCite, canChangeEvidence } from '#lib/components/evidence/evidence-permissions.js';
	import RepositoryDialog from '#lib/components/evidence/RepositoryDialog.svelte';
	import SourceDialog from '#lib/components/evidence/SourceDialog.svelte';
	import SourceMergeDialog from '#lib/components/evidence/SourceMergeDialog.svelte';
	import Pager from '#lib/components/lists/Pager.svelte';
	import { getTreeContext } from '#lib/components/tree/tree-context.js';
	import { TOAST_TONES } from '#lib/components/feedback/toasts.svelte.js';
	import { messageOf } from '#lib/components/feedback/error-message.js';
	import { deleteRepositoryApi, fetchSource, previewEvidenceApi } from '#lib/api/evidence.js';
	import {
		type RepositoryListItem,
		type SourceDto,
		type SourceListItem
	} from '#lib/shared/evidence.js';
	import type { PageProps } from './$types';
	import { treePath } from '#lib/shared/tree-slug.js';

	let { data }: PageProps = $props();
	const { editor, toasts } = getTreeContext();

	const treeId = $derived(data.summary.tree.id);
	const base = $derived(treePath(data.summary.tree));
	const role = $derived(data.trees.find((t) => t.id === treeId)?.role);
	const page = $derived(data.page);
	const pageHref = (offset: number) => {
		const params = new URLSearchParams();
		if (data.q) params.set('q', data.q);
		if (offset > 0) params.set('offset', String(offset));
		return `${base}/sources${params.size > 0 ? `?${params}` : ''}`;
	};

	let isSourceDialogOpen = $state(false);
	/** The source being edited from the list, read in full because a list row lacks its text. */
	let editing = $state<SourceDto | null>(null);
	let merging = $state<SourceListItem | null>(null);
	const nameOf = (item: SourceListItem) => item.title ?? item.abbreviation ?? 'Untitled source';

	async function edit(item: SourceListItem) {
		try {
			editing = await fetchSource(
				treeId,
				item.id,
				new URLSearchParams({ offset: '0', limit: '1' })
			);
		} catch (cause) {
			toasts.push(messageOf(cause, 'Could not open the source'), { tone: TOAST_TONES.ERROR });
		}
	}
	let repositoryDialog = $state<{ repository: RepositoryListItem | null } | null>(null);

	function removeRepository(repository: RepositoryListItem) {
		void editor.confirmWithImpact({
			title: `Delete the repository “${repository.name ?? 'Unnamed'}”?`,
			confirmLabel: 'Delete repository',
			preview: () =>
				previewEvidenceApi(treeId, { kind: 'delete_repository', repositoryId: repository.id }),
			run: () => deleteRepositoryApi(treeId, repository.id, repository.version),
			done: 'Repository deleted'
		});
	}
</script>

<svelte:head>
	<title>Sources · {data.summary.tree.name} · Epoch</title>
</svelte:head>

<header class="flex flex-wrap items-start justify-between gap-3">
	<div>
		<h1 class="text-2xl font-bold text-stone-900">Sources</h1>
		<p class="mt-1 max-w-2xl text-sm text-stone-600">
			The records the tree's facts are drawn from. Open a source to see everything it supports.
		</p>
	</div>
	{#if canCite(role)}
		<button type="button" class="action-btn" onclick={() => (isSourceDialogOpen = true)}
			><Plus class="h-3.5 w-3.5" />Add source</button
		>
	{/if}
</header>

<form method="get" class="mt-4 flex items-end gap-2" role="search">
	<div>
		<label for="source-filter" class="block text-xs font-semibold text-stone-700"
			>Find a source</label
		>
		<input
			id="source-filter"
			name="q"
			type="search"
			value={data.q}
			autocomplete="off"
			class="mt-1 w-64 rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
			placeholder="Title or author"
		/>
	</div>
	<button type="submit" class="btn-primary">Find</button>
</form>

<div class="mt-4">
	{#if page.items.length === 0}
		<p class="text-sm text-stone-700" data-testid="no-sources">
			{data.q ? 'No source matches.' : 'No sources recorded.'}
		</p>
	{:else}
		<ul
			class="divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white"
			data-testid="sources-list"
		>
			{#each page.items as item (item.id)}
				<li class="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2 text-sm">
					<span>
						<a
							href={`${base}/sources/${encodeURIComponent(item.id)}`}
							class="font-semibold text-emerald-900 hover:underline">{nameOf(item)}</a
						>
						{#if item.author}<span class="text-xs text-stone-600"> · {item.author}</span>{/if}
					</span>
					<span class="flex flex-wrap items-center gap-x-3 gap-y-1 text-stone-600">
						<span>{item.citationCount} {item.citationCount === 1 ? 'citation' : 'citations'}</span>
						{#if item.fileCount > 0}
							<span data-testid="source-file-count"
								>{item.fileCount} {item.fileCount === 1 ? 'file' : 'files'}</span
							>
						{/if}
						{#if canChangeEvidence(role)}
							<button
								type="button"
								class="row-link inline-flex items-center gap-1 text-xs font-semibold"
								onclick={() => void edit(item)}
								aria-label={`Edit ${nameOf(item)}`}
								><Pencil class="h-3 w-3" aria-hidden="true" />Edit</button
							>
							<button
								type="button"
								class="row-link inline-flex items-center gap-1 text-xs font-semibold"
								onclick={() => (merging = item)}
								aria-label={`Merge other sources into ${nameOf(item)}`}
								><GitMerge class="h-3 w-3" aria-hidden="true" />Merge…</button
							>
						{/if}
					</span>
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

<section aria-labelledby="repositories-heading" class="section-card mt-8">
	<div class="flex items-center justify-between gap-3">
		<h3 id="repositories-heading" class="section-heading">Repositories</h3>
		{#if canCite(role)}
			<button
				type="button"
				class="action-btn"
				onclick={() => (repositoryDialog = { repository: null })}
				><Plus class="h-3.5 w-3.5" />Add repository</button
			>
		{/if}
	</div>
	{#if data.repositories.items.length === 0}
		<p class="mt-2 text-xs text-stone-500 italic">
			No repository is recorded. A repository is an archive, library or website that holds sources.
		</p>
	{:else}
		<ul class="mt-2 space-y-1 text-sm" data-testid="repositories-list">
			{#each data.repositories.items as repository (repository.id)}
				<li class="flex flex-wrap items-baseline justify-between gap-2">
					<span class="font-medium">{repository.name ?? 'Unnamed repository'}</span>
					<span class="flex items-center gap-3 text-xs text-stone-600">
						{repository.sourceCount}
						{repository.sourceCount === 1 ? 'source' : 'sources'}
						{#if canChangeEvidence(role)}
							<button
								type="button"
								class="row-link font-semibold"
								onclick={() => (repositoryDialog = { repository })}
								aria-label={`Edit ${repository.name ?? 'the repository'}`}>Edit</button
							>
							<button
								type="button"
								class="row-link font-semibold text-red-700"
								onclick={() => removeRepository(repository)}
								aria-label={`Delete ${repository.name ?? 'the repository'}`}>Delete</button
							>
						{/if}
					</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<SourceDialog
	isOpen={isSourceDialogOpen}
	{treeId}
	source={null}
	onsaved={async (change, sourceId) => {
		isSourceDialogOpen = false;
		await editor.afterChange(change, 'Source added');
		await goto(`${base}/sources/${encodeURIComponent(sourceId)}`);
	}}
	onstale={async () => {
		isSourceDialogOpen = false;
		await editor.refresh();
	}}
	oncancel={() => (isSourceDialogOpen = false)}
/>

<SourceDialog
	isOpen={editing !== null}
	{treeId}
	source={editing}
	onsaved={async (change) => {
		editing = null;
		await editor.afterChange(change, 'Source saved');
	}}
	onstale={async () => {
		editing = null;
		await editor.refresh();
	}}
	oncancel={() => (editing = null)}
/>

{#if merging}
	<SourceMergeDialog
		isOpen
		{treeId}
		survivor={{ id: merging.id, version: merging.version, label: nameOf(merging) }}
		onmerged={async (change) => {
			merging = null;
			await editor.afterChange(change, 'Sources merged');
		}}
		oncancel={() => (merging = null)}
	/>
{/if}

<RepositoryDialog
	isOpen={repositoryDialog !== null}
	{treeId}
	repository={repositoryDialog?.repository ?? null}
	onsaved={async (change) => {
		repositoryDialog = null;
		await editor.afterChange(change, 'Repository saved');
	}}
	onstale={async () => {
		repositoryDialog = null;
		await editor.refresh();
	}}
	oncancel={() => (repositoryDialog = null)}
/>
