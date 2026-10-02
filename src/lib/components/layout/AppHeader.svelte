<script lang="ts">
	import { GitBranch, Plus, Trash2, UserPlus, Upload, Download } from 'lucide-svelte';
	import type { TreeSummary } from '#lib/types/genealogy.js';

	interface Props {
		trees: TreeSummary[];
		selectedTreeId: string | null;
		isImporting?: boolean;
		onselectTree: (id: string) => void;
		onopenNewTree: () => void;
		onopenDeleteTree: () => void;
		onopenAddPerson: () => void;
		onfileSelect: (e: Event) => void;
		onexportGedcom: () => void;
		/** Export carries every person, living ones included, so it is offered to managers and owners only. */
		canExport?: boolean;
	}

	let {
		trees = [],
		selectedTreeId,
		isImporting = false,
		onselectTree,
		onopenNewTree,
		onopenDeleteTree,
		onopenAddPerson,
		onfileSelect,
		onexportGedcom,
		canExport = false
	}: Props = $props();
</script>

<header
	class="sticky top-0 z-30 flex min-h-16 flex-wrap items-center justify-between gap-2 border-b border-stone-200/80 bg-[#fdfbf7]/90 px-3 py-2 shadow-xs backdrop-blur-md sm:px-6"
>
	<div class="flex items-center space-x-3">
		<div
			class="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-emerald-800 to-emerald-700 shadow-md shadow-emerald-900/15"
		>
			<GitBranch class="h-5 w-5 text-amber-50" />
		</div>
		<div>
			<h1 class="text-base font-bold tracking-tight text-stone-900">Epoch Genealogy</h1>
			<p class="text-[10px] font-medium tracking-wide text-stone-500">
				Cloudflare D1 &amp; R2 Architecture
			</p>
		</div>
	</div>

	<!-- Tree Selector & Actions -->
	<div class="flex flex-wrap items-center gap-2">
		{#if trees.length > 0}
			<select
				aria-label="Tree"
				value={selectedTreeId}
				onchange={(e) => onselectTree(e.currentTarget.value)}
				class="rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-xs font-medium text-stone-800 shadow-xs focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 focus:outline-none"
			>
				{#each trees as t (t.id)}
					<option value={t.id}>{t.name}</option>
				{/each}
			</select>
		{/if}

		<button
			type="button"
			onclick={onopenNewTree}
			class="inline-flex cursor-pointer items-center space-x-1.5 rounded-lg border border-stone-300 bg-stone-100 px-3 py-1.5 text-xs font-semibold text-stone-800 shadow-xs transition-colors hover:bg-stone-200/80"
		>
			<Plus class="h-3.5 w-3.5 text-emerald-800" />
			<span>New Tree</span>
		</button>

		{#if selectedTreeId}
			<!-- Delete Tree Action -->
			<button
				type="button"
				onclick={onopenDeleteTree}
				title="Delete this tree"
				aria-label="Delete this tree"
				class="inline-flex cursor-pointer items-center justify-center rounded-lg border border-stone-300 bg-stone-100 px-2.5 py-1.5 text-xs font-semibold text-red-700 shadow-xs transition-colors hover:border-red-300 hover:bg-red-50"
			>
				<Trash2 class="h-3.5 w-3.5" />
			</button>

			<!-- Add Person Action -->
			<button
				type="button"
				onclick={onopenAddPerson}
				class="inline-flex cursor-pointer items-center space-x-1.5 rounded-lg bg-emerald-800 px-3 py-1.5 text-xs font-semibold text-amber-50 shadow-sm shadow-emerald-900/15 transition-colors hover:bg-emerald-700"
			>
				<UserPlus class="h-3.5 w-3.5" />
				<span>Add Person</span>
			</button>
		{/if}

		<!-- Import GEDCOM -->
		<label
			class="inline-flex cursor-pointer items-center space-x-1.5 rounded-lg border border-stone-300 bg-stone-100 px-3 py-1.5 text-xs font-semibold text-stone-800 shadow-xs transition-colors hover:bg-stone-200/80"
		>
			<Upload class="h-3.5 w-3.5 text-stone-600" />
			<span>Import GEDCOM</span>
			<input
				type="file"
				accept=".ged,.gedcom"
				onchange={onfileSelect}
				class="hidden"
				disabled={isImporting}
			/>
		</label>

		<!-- Export GEDCOM -->
		{#if selectedTreeId && canExport}
			<button
				type="button"
				onclick={onexportGedcom}
				class="inline-flex cursor-pointer items-center space-x-1.5 rounded-lg border border-stone-300 bg-stone-100 px-3 py-1.5 text-xs font-semibold text-stone-800 shadow-xs transition-colors hover:bg-stone-200/80"
			>
				<Download class="h-3.5 w-3.5 text-stone-600" />
				<span>Export 5.5.1</span>
			</button>
		{/if}
	</div>
</header>
