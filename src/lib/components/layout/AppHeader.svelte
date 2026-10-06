<script lang="ts">
	import { UserPlus } from 'lucide-svelte';
	import type { Snippet } from 'svelte';
	import EpochMark from '#lib/components/brand/EpochMark.svelte';
	import TreeSwitcher from '#lib/components/layout/TreeSwitcher.svelte';
	import type { TreeSummary } from '#lib/types/genealogy.js';

	interface Props {
		trees: TreeSummary[];
		selectedTreeId: string | null;
		/** Counts from the tree summary, shown under the tree's name; omitted where no tree is open. */
		counts?: { people: number; unions: number };
		isImporting?: boolean;
		onselectTree: (id: string) => void;
		onopenNewTree: () => void;
		onopenDeleteTree: () => void;
		onopenAddPerson: () => void;
		onfileSelect: (e: Event) => void;
		onexportGedcom: () => void;
		/** Export carries every person, living ones included, so it is offered to managers and owners only. */
		canExport?: boolean;
		/** The person finder, placed between the tree switcher and Add person on tree pages. */
		finder?: Snippet;
	}

	let {
		trees = [],
		selectedTreeId,
		counts,
		isImporting = false,
		onselectTree,
		onopenNewTree,
		onopenDeleteTree,
		onopenAddPerson,
		onfileSelect,
		onexportGedcom,
		canExport = false,
		finder
	}: Props = $props();
</script>

<header
	class="sticky top-0 z-30 flex min-h-16 flex-wrap items-center gap-x-3 gap-y-2 border-b border-stone-200/80 bg-[#fdfbf7]/90 px-3 py-2 shadow-xs backdrop-blur-md sm:px-6"
>
	<div class="flex items-center space-x-3">
		<div
			class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-800 shadow-md shadow-emerald-900/15"
		>
			<EpochMark size={26} ink="#fffbeb" ancestryOpacity={0.5} />
		</div>
		<div class="hidden lg:block">
			<h1 class="text-base font-bold tracking-tight text-stone-900">Epoch</h1>
			<p class="text-[10px] font-medium tracking-wide text-stone-500">Family history</p>
		</div>
	</div>

	<TreeSwitcher
		{trees}
		{selectedTreeId}
		{counts}
		{isImporting}
		{onselectTree}
		{onopenNewTree}
		{onopenDeleteTree}
		{onfileSelect}
		{onexportGedcom}
		{canExport}
	/>

	<!-- Wraps to its own full-width row on phones so the finder keeps room to type. -->
	<div class="order-last w-full sm:order-none sm:w-auto sm:max-w-md sm:min-w-56 sm:flex-1">
		{@render finder?.()}
	</div>

	{#if selectedTreeId}
		<button
			type="button"
			onclick={onopenAddPerson}
			aria-label="Add person"
			class="ml-auto inline-flex min-h-9 cursor-pointer items-center space-x-1.5 rounded-lg bg-emerald-800 px-2.5 py-1.5 text-xs font-semibold text-amber-50 shadow-sm shadow-emerald-900/15 transition-colors hover:bg-emerald-700 sm:px-3"
		>
			<UserPlus class="h-3.5 w-3.5" />
			<span class="hidden sm:inline">Add person</span>
		</button>
	{/if}
</header>
