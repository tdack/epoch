<script lang="ts">
	import { goto } from '$app/navigation';
	import { GitMerge, Pencil, Trash2 } from '@lucide/svelte';
	import Pager from '#lib/components/lists/Pager.svelte';
	import NoteMergeDialog from '#lib/components/notes/NoteMergeDialog.svelte';
	import SharedNoteDialog from '#lib/components/notes/SharedNoteDialog.svelte';
	import { canChangeNote } from '#lib/components/notes/note-permissions.js';
	import { getTreeContext } from '#lib/components/tree/tree-context.js';
	import { runInSteps } from '#lib/api/client.js';
	import { deleteSharedNoteApi, previewNoteApi } from '#lib/api/notes.js';
	import { noteTitle } from '#lib/shared/notes.js';
	import type { PageProps } from './$types';
	import { treePath } from '#lib/shared/tree-slug.js';

	let { data }: PageProps = $props();
	const { editor } = getTreeContext();

	const note = $derived(data.note);
	const treeId = $derived(data.summary.tree.id);
	const base = $derived(treePath(data.summary.tree));
	const role = $derived(data.trees.find((t) => t.id === treeId)?.role);
	const title = $derived(noteTitle(note.text, 60));
	const pageHref = (offset: number) =>
		`${base}/notes/${encodeURIComponent(note.id)}${offset > 0 ? `?offset=${offset}` : ''}`;

	let isEditing = $state(false);
	let isMerging = $state(false);

	function remove() {
		const isUsed = note.useCount > 0;
		void editor.confirmWithImpact({
			title: isUsed
				? `Delete this note and detach it from ${note.useCount} ${note.useCount === 1 ? 'record' : 'records'}?`
				: 'Delete this note?',
			confirmLabel: isUsed ? 'Delete and detach' : 'Delete note',
			preview: () =>
				previewNoteApi(treeId, {
					kind: 'delete_shared_note',
					noteId: note.id,
					version: note.version,
					shouldDetach: true
				}),
			run: async (onprogress) => {
				// A note used more than one change writes is detached in steps; it is deleted with the last.
				const result = await runInSteps(
					() =>
						deleteSharedNoteApi(treeId, note.id, {
							version: note.version,
							shouldDetach: true
						}),
					(left) => onprogress(`${left} uses to go…`)
				);
				await goto(`${base}/notes`, { replace: true });
				return result;
			},
			done: 'Note deleted'
		});
	}

	const hrefOf = (use: {
		personId: string | null;
		unionId: string | null;
		sourceId: string | null;
	}) =>
		use.personId
			? `${base}/people/${encodeURIComponent(use.personId)}`
			: use.unionId
				? `${base}/unions/${encodeURIComponent(use.unionId)}`
				: use.sourceId
					? `${base}/sources/${encodeURIComponent(use.sourceId)}`
					: null;
</script>

<svelte:head>
	<title>{title} · Notes · Epoch</title>
</svelte:head>

<nav aria-label="Breadcrumb" class="text-xs text-stone-600">
	<a href={base} class="text-link">{data.summary.tree.name}</a>
	<span aria-hidden="true"> › </span>
	<a href={`${base}/notes`} class="text-link">Notes</a>
	<span aria-hidden="true"> › </span>
	<span aria-current="page">{title}</span>
</nav>

<header class="flex flex-wrap items-start justify-between gap-3">
	<div>
		<h1 class="text-2xl font-bold text-stone-900">Shared note</h1>
		<p class="mt-1 text-sm text-stone-600" data-testid="note-use-count">
			Used by {note.useCount}
			{note.useCount === 1 ? 'record' : 'records'}{#if note.language}
				· {note.language}{/if}{#if note.mime}
				· {note.mime}{/if}
		</p>
	</div>
	{#if canChangeNote(role)}
		<div class="flex flex-wrap gap-2">
			<button type="button" class="action-btn" onclick={() => (isEditing = true)}
				><Pencil class="h-3.5 w-3.5" />Edit</button
			>
			<button type="button" class="action-btn" onclick={() => (isMerging = true)}
				><GitMerge class="h-3.5 w-3.5" />Merge…</button
			>
			<button type="button" class="action-btn text-red-700" onclick={remove}
				><Trash2 class="h-3.5 w-3.5" />Delete…</button
			>
		</div>
	{/if}
</header>

<p class="section-card text-sm whitespace-pre-line text-stone-800" data-testid="note-text">
	{note.text}
</p>

<section aria-labelledby="used-heading" class="section-card">
	<h3 id="used-heading" class="section-heading">Where it is used</h3>
	{#if note.uses.length === 0}
		<p class="mt-2 text-xs text-stone-500 italic print:hidden" data-testid="not-used">
			No record you can see uses this note yet. Attach it from a person, a fact or a partnership.
		</p>
	{:else}
		<ul class="mt-3 space-y-1 text-sm" data-testid="note-uses">
			{#each note.uses as use (use.attachmentId)}
				<li data-testid="note-use">
					{#if hrefOf(use)}<a href={hrefOf(use)} class="text-link">{use.label}</a
						>{:else}{use.label}{/if}
				</li>
			{/each}
		</ul>
		<div class="mt-4">
			<Pager
				summary={`Showing ${note.offset + 1} to ${note.offset + note.uses.length} of ${note.useCount}`}
				previousHref={note.offset > 0 ? pageHref(Math.max(0, note.offset - note.limit)) : null}
				nextHref={note.hasMore ? pageHref(note.offset + note.limit) : null}
			/>
		</div>
	{/if}
</section>

{#if note.xref}
	<p class="text-xs text-stone-500">Record number {note.xref}</p>
{/if}

<SharedNoteDialog
	isOpen={isEditing}
	{treeId}
	{note}
	onsaved={async (change) => {
		isEditing = false;
		await editor.afterChange(change, 'Note saved');
	}}
	onstale={async () => {
		isEditing = false;
		await editor.refresh();
	}}
	oncancel={() => (isEditing = false)}
/>

<NoteMergeDialog
	isOpen={isMerging}
	{treeId}
	survivor={{ id: note.id, version: note.version, label: title }}
	onmerged={async (change) => {
		isMerging = false;
		await editor.afterChange(change, 'Notes merged');
	}}
	oncancel={() => (isMerging = false)}
/>
