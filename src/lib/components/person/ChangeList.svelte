<script lang="ts">
	import type { TreeEditor } from '#lib/components/tree/tree-editor.svelte.js';
	import type { ChangeEntryDto } from '#lib/shared/person-page.js';
	import { treePath, type TreeRef } from '#lib/shared/tree-slug.js';

	interface Props {
		/** The record's recent changes, each already carrying whether this viewer may undo it. */
		changes: ChangeEntryDto[];
		/** The person or partnership, for the link to every change that wrote it. */
		recordId: string;
		tree: TreeRef;
		editor: Pick<TreeEditor, 'undoChange'>;
		/** What to say when the record has no logged changes. */
		emptyText: string;
	}

	let { changes, recordId, tree, editor, emptyText }: Props = $props();

	const when = (ms: number) => new Date(ms).toLocaleString();
</script>

{#if changes.length === 0}
	<p class="mt-2 text-xs text-stone-500 italic print:hidden">{emptyText}</p>
{:else}
	<ul class="mt-2 space-y-1.5 text-xs" data-testid="history">
		{#each changes as change (change.id)}
			<li class="flex flex-wrap items-baseline justify-between gap-x-3">
				<span class="min-w-0">
					<span class="font-medium text-stone-800">{change.summary}</span>
					<span class="block text-stone-500"
						>{change.actorName ?? 'Someone'} · {when(change.createdAt)}{change.isUndone
							? ' · undone'
							: ''}</span
					>
				</span>
				{#if change.canUndo}
					<button
						type="button"
						class="text-link coarse:min-h-11"
						aria-label={`Undo: ${change.summary}`}
						onclick={() => editor.undoChange(change.id)}>Undo</button
					>
				{/if}
			</li>
		{/each}
	</ul>
	<a
		class="text-link mt-2 inline-block text-xs"
		href={`${treePath(tree)}/audit?record=${encodeURIComponent(recordId)}`}>See all changes</a
	>
{/if}
