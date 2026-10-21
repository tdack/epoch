<script lang="ts">
	import { Check, ChevronDown, Plus, Upload } from '@lucide/svelte';
	import Popover from '#lib/components/layout/Popover.svelte';
	import type { TreeSummary } from '#lib/types/genealogy.js';
	import type { SubtreeSummaryDto } from '#lib/shared/subtrees.js';
	import { GEDCOM_FILE_ACCEPT } from '#lib/shared/gedcom-files.js';

	interface Props {
		trees: TreeSummary[];
		/** The tree being viewed; null where there is none yet, which leaves only the ways to make one. */
		selectedTreeId: string | null;
		/** Counts from the tree summary, shown under the name; omitted where no tree is open. */
		counts?: { people: number; unions: number };
		/** The active sub-tree's name: counts then describe its members, and read "<name> · N people". */
		subtreeName?: string | null;
		isImporting?: boolean;
		/** The selected tree's sub-trees, listed indented under it; none for the public visitor. */
		subtrees?: SubtreeSummaryDto[];
		/** The sub-tree lens in force, if any; the tree's own entry is checked when there is none. */
		activeSubtreeId?: string | null;
		/** Opens the whole tree: a lens in force is dropped. */
		onselectTree: (id: string) => void;
		onselectSubtree?: (subtree: SubtreeSummaryDto) => void;
		onopenNewTree: () => void;
		onfileSelect: (e: Event) => void;
		/** False for the public visitor: no way to start or import a tree. Defaults to true. */
		canChangeTrees?: boolean;
	}

	let {
		trees,
		selectedTreeId,
		counts,
		subtreeName = null,
		isImporting = false,
		subtrees = [],
		activeSubtreeId = null,
		onselectTree,
		onselectSubtree,
		onopenNewTree,
		onfileSelect,
		canChangeTrees = true
	}: Props = $props();

	let fileInput: HTMLInputElement | undefined = $state();

	const selected = $derived(trees.find((t) => t.id === selectedTreeId));
	const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
	const itemClass =
		'flex w-full cursor-pointer items-center gap-2 menu-item px-3 py-2 text-left text-xs font-medium aria-disabled:cursor-default aria-disabled:opacity-50';
</script>

<!-- Always mounted, outside the menu, so a file can be chosen without the menu being open. -->
<input
	bind:this={fileInput}
	type="file"
	accept={GEDCOM_FILE_ACCEPT}
	onchange={onfileSelect}
	class="hidden"
	disabled={isImporting}
	aria-label="GEDCOM file to import"
	tabindex="-1"
/>

<Popover label="Trees" panelClass="w-64 max-w-[calc(100vw-1.5rem)] py-1">
	{#snippet trigger(attrs)}
		<button
			type="button"
			{...attrs}
			class="flex max-w-[11rem] cursor-pointer items-center gap-2 rounded-lg border border-stone-300 bg-stone-50 px-3 py-1 text-left shadow-xs focus-ring transition-colors hover:bg-stone-100 sm:max-w-xs coarse:min-h-11"
		>
			<span class="min-w-0">
				<span class="block truncate text-xs font-semibold text-stone-900">
					{selected?.name ?? 'Trees'}
				</span>
				{#if counts}
					<span class="hidden truncate text-xs text-stone-500 sm:block">
						{#if subtreeName}
							{subtreeName} · {plural(counts.people, 'person', 'people')}
						{:else}
							{plural(counts.people, 'person', 'people')} · {plural(
								counts.unions,
								'partnership',
								'partnerships'
							)}
						{/if}
					</span>
				{/if}
			</span>
			<ChevronDown class="h-3.5 w-3.5 shrink-0 text-stone-500" aria-hidden="true" />
		</button>
	{/snippet}

	{#if trees.length > 0}
		<p class="px-3 pt-1.5 pb-1 text-xs font-bold tracking-wide text-stone-600 uppercase">
			{canChangeTrees ? 'Your trees' : 'Public tree'}
		</p>
		{#each trees as t (t.id)}
			<button
				type="button"
				role="menuitemradio"
				aria-checked={t.id === selectedTreeId && !activeSubtreeId}
				class={itemClass}
				onclick={() => (t.id !== selectedTreeId || activeSubtreeId) && onselectTree(t.id)}
			>
				<Check
					class="h-3.5 w-3.5 shrink-0 text-emerald-800 {t.id === selectedTreeId && !activeSubtreeId
						? ''
						: 'invisible'}"
					aria-hidden="true"
				/>
				<span class="truncate">{t.name}</span>
			</button>
			{#if t.id === selectedTreeId}
				{#each subtrees as sub (sub.id)}
					<button
						type="button"
						role="menuitemradio"
						aria-checked={sub.id === activeSubtreeId}
						class="{itemClass} pl-7"
						onclick={() => sub.id !== activeSubtreeId && onselectSubtree?.(sub)}
					>
						<Check
							class="h-3.5 w-3.5 shrink-0 text-emerald-800 {sub.id === activeSubtreeId
								? ''
								: 'invisible'}"
							aria-hidden="true"
						/>
						<span class="truncate">{sub.name}</span>
					</button>
				{/each}
			{/if}
		{/each}
		<div role="separator" class="my-1 border-t border-stone-200"></div>
	{/if}

	{#if canChangeTrees}
		<button type="button" role="menuitem" class={itemClass} onclick={onopenNewTree}>
			<Plus class="h-3.5 w-3.5 shrink-0 text-emerald-800" aria-hidden="true" />
			New tree…
		</button>
		<button
			type="button"
			role="menuitem"
			aria-disabled={isImporting}
			class={itemClass}
			onclick={() => !isImporting && fileInput?.click()}
		>
			<Upload class="h-3.5 w-3.5 shrink-0 text-stone-600" aria-hidden="true" />
			Import GEDCOM…
		</button>
	{/if}
</Popover>
