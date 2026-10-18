<script lang="ts">
	import { Check, ChevronDown, Download, Pencil, Plus, Trash2, Upload } from '@lucide/svelte';
	import Popover from '#lib/components/layout/Popover.svelte';
	import type { GedcomExportChoice } from '#lib/api/files.js';
	import type { TreeSummary } from '#lib/types/genealogy.js';
	import type { SubtreeSummaryDto } from '#lib/shared/subtrees.js';
	import { GEDCOM_FILE_ACCEPT } from '#lib/shared/gedcom-files.js';

	interface Props {
		trees: TreeSummary[];
		/** The tree being viewed; null where there is none yet, which leaves only the ways to make one. */
		selectedTreeId: string | null;
		/** Counts from the tree summary, shown under the name; omitted where no tree is open. */
		counts?: { people: number; unions: number };
		isImporting?: boolean;
		/** The selected tree's sub-trees, listed indented under it; none for the public visitor. */
		subtrees?: SubtreeSummaryDto[];
		/** The sub-tree lens in force, if any; the tree's own entry is checked when there is none. */
		activeSubtreeId?: string | null;
		/** Opens the whole tree: a lens in force is dropped. */
		onselectTree: (id: string) => void;
		onselectSubtree?: (subtree: SubtreeSummaryDto) => void;
		onopenNewTree: () => void;
		onopenDeleteTree: () => void;
		/** Absent below manager, who may not rename (`tree:update_settings`), so the item is not shown. */
		onopenRenameTree?: () => void;
		onfileSelect: (e: Event) => void;
		/** Called with the version and packaging chosen; a plain "Export" is GEDCOM 7.0, uncompressed. */
		onexportGedcom: (choice: GedcomExportChoice) => void;
		/** Export carries every person, living ones included, so it is offered to managers and owners only. */
		canExport?: boolean;
		/** False for the public visitor: no way to start, import or delete a tree. Defaults to true. */
		canChangeTrees?: boolean;
	}

	let {
		trees,
		selectedTreeId,
		counts,
		isImporting = false,
		subtrees = [],
		activeSubtreeId = null,
		onselectTree,
		onselectSubtree,
		onopenNewTree,
		onopenDeleteTree,
		onopenRenameTree,
		onfileSelect,
		onexportGedcom,
		canExport = false,
		canChangeTrees = true
	}: Props = $props();

	const uid = $props.id();
	let fileInput: HTMLInputElement | undefined = $state();
	let isOpen = $state(false);

	// The export's options live behind the chevron, and every opening of the menu starts from the
	// default again, so the one-click "Export" is always GEDCOM 7.0 whatever was chosen last time.
	let areExportOptionsShown = $state(false);
	let exportFormat: GedcomExportChoice['format'] = $state('gedcom7');
	let shouldCompress = $state(false);
	$effect(() => {
		if (isOpen) return;
		areExportOptionsShown = false;
		exportFormat = 'gedcom7';
		shouldCompress = false;
	});
	const isGedzipPossible = $derived(exportFormat === 'gedcom7');
	const exportLabel = $derived(
		`Export GEDCOM ${exportFormat === 'gedcom7' ? '7.0' : '5.5.1'}${shouldCompress ? ' (.gdz)' : ''}`
	);
	const formats: { value: GedcomExportChoice['format']; label: string }[] = [
		{ value: 'gedcom7', label: 'GEDCOM 7.0' },
		{ value: 'gedcom551', label: 'GEDCOM 5.5.1 (legacy)' }
	];

	function chooseFormat(format: GedcomExportChoice['format']) {
		exportFormat = format;
		// GEDZip holds a 7.0 file only.
		if (format !== 'gedcom7') shouldCompress = false;
	}

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

<Popover bind:isOpen label="Trees" panelClass="w-64 max-w-[calc(100vw-1.5rem)] py-1">
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
	{#if selectedTreeId && canExport}
		<div class="flex items-stretch">
			<button
				type="button"
				role="menuitem"
				class="{itemClass} min-w-0 flex-1"
				onclick={() => onexportGedcom({ format: exportFormat, shouldCompress })}
			>
				<Download class="h-3.5 w-3.5 shrink-0 text-stone-600" aria-hidden="true" />
				<span class="truncate">{exportLabel}</span>
			</button>
			<button
				type="button"
				role="menuitem"
				data-keep-open
				aria-label="Export options"
				aria-expanded={areExportOptionsShown}
				aria-controls="{uid}-export-options"
				class="flex menu-item w-9 shrink-0 cursor-pointer items-center justify-center border-l border-stone-200 text-stone-600"
				onclick={() => (areExportOptionsShown = !areExportOptionsShown)}
			>
				<ChevronDown
					class="h-3.5 w-3.5 transition-transform motion-reduce:transition-none {areExportOptionsShown
						? 'rotate-180'
						: ''}"
					aria-hidden="true"
				/>
			</button>
		</div>
		{#if areExportOptionsShown}
			<div
				id="{uid}-export-options"
				role="group"
				aria-label="Export options"
				class="mx-2 mb-1 rounded-lg bg-stone-50 py-1"
			>
				{#each formats as f (f.value)}
					<button
						type="button"
						role="menuitemradio"
						aria-checked={exportFormat === f.value}
						data-keep-open
						class="{itemClass} pl-4"
						onclick={() => chooseFormat(f.value)}
					>
						<Check
							class="h-3.5 w-3.5 shrink-0 text-emerald-800 {exportFormat === f.value
								? ''
								: 'invisible'}"
							aria-hidden="true"
						/>
						{f.label}
					</button>
				{/each}
				<div role="separator" class="mx-3 my-1 border-t border-stone-200"></div>
				<button
					type="button"
					role="menuitemcheckbox"
					aria-checked={shouldCompress}
					aria-disabled={!isGedzipPossible}
					aria-describedby={isGedzipPossible ? undefined : `${uid}-gdz-note`}
					data-keep-open
					class="{itemClass} pl-4"
					onclick={() => isGedzipPossible && (shouldCompress = !shouldCompress)}
				>
					<span
						class="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border {shouldCompress
							? 'border-emerald-800 bg-emerald-800 text-white'
							: 'border-stone-400 bg-white'}"
						aria-hidden="true"
					>
						{#if shouldCompress}<Check class="h-3 w-3" strokeWidth={3} />{/if}
					</span>
					Compress to .gdz
				</button>
				{#if !isGedzipPossible}
					<p id="{uid}-gdz-note" class="px-4 pb-1 pl-9 text-xs text-stone-500">
						GEDZip holds GEDCOM 7.0 files only.
					</p>
				{/if}
			</div>
		{/if}
	{/if}
	{#if selectedTreeId && canChangeTrees}
		<div role="separator" class="my-1 border-t border-stone-200"></div>
		{#if onopenRenameTree}
			<button type="button" role="menuitem" class={itemClass} onclick={onopenRenameTree}>
				<Pencil class="h-3.5 w-3.5 shrink-0 text-stone-600" aria-hidden="true" />
				Rename this tree…
			</button>
		{/if}
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
