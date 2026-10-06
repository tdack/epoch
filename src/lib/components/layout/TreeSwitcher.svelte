<script lang="ts">
	import { Check, ChevronDown, Download, Plus, Trash2, Upload } from 'lucide-svelte';
	import Popover from '#lib/components/layout/Popover.svelte';
	import type { TreeSummary } from '#lib/types/genealogy.js';

	interface Props {
		trees: TreeSummary[];
		/** The tree being viewed; null where there is none yet, which leaves only the ways to make one. */
		selectedTreeId: string | null;
		/** Counts from the tree summary, shown under the name; omitted where no tree is open. */
		counts?: { people: number; unions: number };
		isImporting?: boolean;
		onselectTree: (id: string) => void;
		onopenNewTree: () => void;
		onopenDeleteTree: () => void;
		onfileSelect: (e: Event) => void;
		onexportGedcom: () => void;
		/** Export carries every person, living ones included, so it is offered to managers and owners only. */
		canExport?: boolean;
	}

	let {
		trees,
		selectedTreeId,
		counts,
		isImporting = false,
		onselectTree,
		onopenNewTree,
		onopenDeleteTree,
		onfileSelect,
		onexportGedcom,
		canExport = false
	}: Props = $props();

	let fileInput: HTMLInputElement | undefined = $state();

	const selected = $derived(trees.find((t) => t.id === selectedTreeId));
	const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
	const itemClass =
		'flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-xs font-medium hover:bg-stone-100 focus:bg-stone-100 focus:outline-none aria-disabled:cursor-default aria-disabled:opacity-50';
</script>

<!-- Always mounted, outside the menu, so a file can be chosen without the menu being open. -->
<input
	bind:this={fileInput}
	type="file"
	accept=".ged,.gedcom"
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
			class="flex max-w-[11rem] cursor-pointer items-center gap-2 rounded-lg border border-stone-300 bg-stone-50 px-3 py-1 text-left shadow-xs transition-colors hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-emerald-700 sm:max-w-xs"
		>
			<span class="min-w-0">
				<span class="block truncate text-xs font-semibold text-stone-900">
					{selected?.name ?? 'Trees'}
				</span>
				{#if counts}
					<span class="hidden truncate text-[11px] text-stone-500 sm:block">
						{plural(counts.people, 'person', 'people')} · {plural(
							counts.unions,
							'partnership',
							'partnerships'
						)}
					</span>
				{/if}
			</span>
			<ChevronDown class="h-3.5 w-3.5 shrink-0 text-stone-500" aria-hidden="true" />
		</button>
	{/snippet}

	{#if trees.length > 0}
		<p class="px-3 pt-1.5 pb-1 text-[11px] font-semibold tracking-wider text-stone-500 uppercase">
			Your trees
		</p>
		{#each trees as t (t.id)}
			<button
				type="button"
				role="menuitemradio"
				aria-checked={t.id === selectedTreeId}
				class={itemClass}
				onclick={() => t.id !== selectedTreeId && onselectTree(t.id)}
			>
				<Check
					class="h-3.5 w-3.5 shrink-0 text-emerald-800 {t.id === selectedTreeId ? '' : 'invisible'}"
					aria-hidden="true"
				/>
				<span class="truncate">{t.name}</span>
			</button>
		{/each}
		<div role="separator" class="my-1 border-t border-stone-200"></div>
	{/if}

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
	{#if selectedTreeId && canExport}
		<button type="button" role="menuitem" class={itemClass} onclick={onexportGedcom}>
			<Download class="h-3.5 w-3.5 shrink-0 text-stone-600" aria-hidden="true" />
			Export GEDCOM 5.5.1
		</button>
	{/if}
	{#if selectedTreeId}
		<div role="separator" class="my-1 border-t border-stone-200"></div>
		<button
			type="button"
			role="menuitem"
			class="{itemClass} text-red-700"
			onclick={onopenDeleteTree}
		>
			<Trash2 class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
			Delete this tree…
		</button>
	{/if}
</Popover>
