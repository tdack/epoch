<script lang="ts">
	import { ChevronDown, Minus, Plus, SlidersHorizontal } from 'lucide-svelte';
	import Popover from '#lib/components/layout/Popover.svelte';
	import type { ParentChildType } from '#lib/shared/relationship-model.js';
	import { countDisplayChanges, displayDefaults } from './display-settings.js';
	import {
		ALL_PARENT_CHILD_TYPES,
		LAYOUT_MODES,
		MAX_COLLATERAL_DEPTH,
		MAX_DEPTH,
		type LayoutMode,
		type TreeViewState
	} from './tree-url.js';
	import { treeTokenStyle } from './tree-tokens.js';
	import { RELATIONSHIP_STYLES } from './tree-view.js';

	interface Props {
		/** The current view; the toolbar reports changes and does not keep its own copy. */
		view: TreeViewState;
		/** The person the chart is centred on; null before the graph has one. */
		focusPerson?: { id: string; name: string } | null;
		/** Move keyboard focus to the header's person finder, where the focus person is changed. */
		onchangeFocus: () => void;
		/** Open the focus person's profile page. */
		onopenProfile: (personId: string) => void;
		/** The focus person's unions, when `layers` can be centred on any of them. */
		unionChoices?: Array<{ id: string; label: string }>;
		/** The union `layers` is centred on now. */
		focusUnionId?: string | null;
		/**
		 * The saved defaults the view starts from, when they can be changed here: the viewer's own,
		 * the tree's, and whether the viewer may set the tree's (the owner).
		 */
		defaults?: { member: LayoutMode | null; tree: LayoutMode | null; canSetTree: boolean };
		/** Save the viewer's own default view; null clears it so the tree's applies. */
		onSetMemberDefault?: (mode: LayoutMode | null) => void;
		/** Save the tree's default view for everyone with no choice of their own. */
		onSetTreeDefault?: (mode: LayoutMode | null) => void;
		/** Merge these fields into the view. */
		onChange: (change: Partial<TreeViewState>) => void;
	}

	let {
		view,
		focusPerson = null,
		onchangeFocus,
		onopenProfile,
		unionChoices = [],
		focusUnionId = null,
		defaults,
		onSetMemberDefault,
		onSetTreeDefault,
		onChange
	}: Props = $props();

	const MODE_LABELS: Record<LayoutMode, string> = {
		flat: 'Flat',
		layers: 'Layers',
		floors: 'Floors'
	};
	/** Below this width the toolbar is a focus chip and a View button; the rest moves into a sheet. */
	const PHONE_MAX_WIDTH_PX = 639;

	let isNarrow = $state(false);
	let isDisplayOpen = $state(false);
	$effect(() => {
		const query = matchMedia(`(max-width: ${PHONE_MAX_WIDTH_PX}px)`);
		isNarrow = query.matches;
		const onQueryChange = (event: MediaQueryListEvent) => (isNarrow = event.matches);
		query.addEventListener('change', onQueryChange);
		return () => query.removeEventListener('change', onQueryChange);
	});

	const isLayers = $derived(view.layoutMode === LAYOUT_MODES.LAYERS);
	const hasPartnerChoice = $derived(isLayers && unionChoices.length > 1);
	const partnerLabel = $derived(
		hasPartnerChoice ? unionChoices.find((c) => c.id === focusUnionId)?.label : undefined
	);
	const changeCount = $derived(countDisplayChanges(view));
	const canShowWiderGroups = $derived(view.layoutMode !== LAYOUT_MODES.FLAT);

	function setDepth(field: 'ancestorDepth' | 'descendantDepth', value: number) {
		onChange({ [field]: Math.min(MAX_DEPTH, Math.max(0, value)) });
	}

	function toggleType(type: ParentChildType) {
		const isShown = view.types.includes(type);
		// Hiding the last type would draw no parentage at all, so one always stays on.
		if (isShown && view.types.length === 1) return;
		onChange({
			types: ALL_PARENT_CHILD_TYPES.filter((t) => (t === type ? !isShown : view.types.includes(t)))
		});
	}

	// One shared size per breakpoint: 44px touch targets in the sheet, compact beside the chart.
	const stepClass = $derived(
		`inline-flex cursor-pointer items-center justify-center rounded-md border border-stone-300 bg-white hover:bg-stone-100 focus-ring disabled:cursor-default disabled:opacity-40 ${
			isNarrow ? 'h-11 w-11' : 'h-7 w-7 coarse:h-11 coarse:w-11'
		}`
	);
	const rowClass = $derived(
		`flex items-center gap-2 ${isNarrow ? 'min-h-11' : 'min-h-7 coarse:min-h-11'}`
	);
	const controlClass =
		'inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-[13px] font-semibold text-stone-800 shadow-xs hover:bg-stone-100 focus-ring coarse:min-h-11';
	const captionClass = 'text-[13px] font-semibold text-stone-600';
	const headingClass = 'text-[11px] font-semibold tracking-wider text-stone-500 uppercase';
	const itemClass =
		'menu-item flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-xs font-medium';
</script>

{#snippet stepper(name: string, field: 'ancestorDepth' | 'descendantDepth')}
	<div class={rowClass} role="group" aria-label="{name} generations">
		<span class={captionClass}>{name}</span>
		<button
			type="button"
			class={stepClass}
			aria-label="Fewer {name.toLowerCase()} generations"
			disabled={view[field] <= 0}
			onclick={() => setDepth(field, view[field] - 1)}
		>
			<Minus class="h-3.5 w-3.5" />
		</button>
		<output class="min-w-5 text-center font-bold tabular-nums" aria-live="polite"
			>{view[field]}</output
		>
		<button
			type="button"
			class={stepClass}
			aria-label="More {name.toLowerCase()} generations"
			disabled={view[field] >= MAX_DEPTH}
			onclick={() => setDepth(field, view[field] + 1)}
		>
			<Plus class="h-3.5 w-3.5" />
		</button>
	</div>
{/snippet}

{#snippet layoutControl()}
	<div
		class="inline-flex overflow-hidden rounded-lg border border-stone-300 bg-white"
		role="group"
		aria-label="Layout"
	>
		{#each Object.values(LAYOUT_MODES) as mode (mode)}
			<button
				type="button"
				class="cursor-pointer px-3 text-[13px] font-semibold focus-ring-inset {isNarrow
					? 'min-h-11 flex-1'
					: 'py-1.5 coarse:min-h-11'} {view.layoutMode === mode
					? 'bg-stone-900 text-[#fdfbf7]'
					: 'text-stone-800 hover:bg-stone-100'}"
				aria-pressed={view.layoutMode === mode}
				onclick={() => onChange({ layoutMode: mode })}
			>
				{MODE_LABELS[mode]}
			</button>
		{/each}
	</div>
{/snippet}

{#snippet toggle(
	title: string,
	isChecked: boolean,
	onToggle: (checked: boolean) => void,
	hint?: string
)}
	<label class="{rowClass} cursor-pointer text-[13px]" title={hint}>
		<input
			type="checkbox"
			class="focus-ring {isNarrow ? 'h-5 w-5' : 'coarse:h-5 coarse:w-5'}"
			checked={isChecked}
			onchange={(e) => onToggle(e.currentTarget.checked)}
		/>
		{title}
	</label>
{/snippet}

{#snippet sideBranches()}
	<div class={rowClass} role="group" aria-label="Relatives off the direct line">
		<span class={captionClass} title="How far to draw aunts, uncles, cousins and their partners">
			Side branches
		</span>
		<button
			type="button"
			class={stepClass}
			aria-label="Fewer side branches"
			disabled={view.collateralDepth <= 0}
			onclick={() => onChange({ collateralDepth: view.collateralDepth - 1 })}
		>
			<Minus class="h-3.5 w-3.5" />
		</button>
		<output class="min-w-5 text-center font-bold tabular-nums" aria-live="polite"
			>{view.collateralDepth}</output
		>
		<button
			type="button"
			class={stepClass}
			aria-label="More side branches"
			disabled={view.collateralDepth >= MAX_COLLATERAL_DEPTH}
			onclick={() => onChange({ collateralDepth: view.collateralDepth + 1 })}
		>
			<Plus class="h-3.5 w-3.5" />
		</button>
	</div>
{/snippet}

{#snippet displayPanel()}
	<div class="grid gap-3 text-[13px] {isNarrow ? '' : 'p-3'}">
		{#if isNarrow}
			<section class="grid gap-1">
				<h3 class={headingClass}>Layout</h3>
				{@render layoutControl()}
			</section>
			<section class="grid gap-1">
				<h3 class={headingClass}>Generations</h3>
				{@render stepper('Ancestors', 'ancestorDepth')}
				{@render stepper('Descendants', 'descendantDepth')}
			</section>
		{/if}

		<section class="grid gap-0.5">
			<h3 class={headingClass}>Relatives</h3>
			{#if canShowWiderGroups}
				{@render sideBranches()}
				{@render toggle(
					'Partner’s family',
					view.shouldIncludePartnerOrigins,
					(isOn) => onChange({ shouldIncludePartnerOrigins: isOn }),
					"Draw the parents and siblings of the focus person's partners"
				)}
			{/if}
			{@render toggle('Siblings', view.shouldIncludeSiblings, (isOn) =>
				onChange({ shouldIncludeSiblings: isOn })
			)}
			{@render toggle(
				'Step-family',
				view.shouldIncludeStepFamilies,
				(isOn) => onChange({ shouldIncludeStepFamilies: isOn }),
				"Draw each partner's other families, such as the focus person's step-children"
			)}
		</section>

		<details open={!isNarrow} class="grid gap-0.5">
			<summary
				class="{headingClass} {isNarrow
					? 'min-h-11 leading-[2.75rem]'
					: ''} cursor-pointer focus-ring"
			>
				Parent links
			</summary>
			<div class="grid gap-0.5">
				{#each ALL_PARENT_CHILD_TYPES as type (type)}
					{@const style = RELATIONSHIP_STYLES[type]}
					<label class="{rowClass} cursor-pointer">
						<input
							type="checkbox"
							class="focus-ring {isNarrow ? 'h-5 w-5' : 'coarse:h-5 coarse:w-5'}"
							checked={view.types.includes(type)}
							onchange={() => toggleType(type)}
						/>
						<svg width="22" height="8" aria-hidden="true">
							<line
								x1="1"
								y1="4"
								x2="21"
								y2="4"
								stroke={`var(${style.colorVar})`}
								stroke-width="2"
								stroke-dasharray={style.dash ?? undefined}
								stroke-linecap={style.isRound ? 'round' : undefined}
							/>
						</svg>
						{style.label}
					</label>
				{/each}
			</div>
		</details>

		{#if defaults}
			<details open={!isNarrow} class="grid gap-1">
				<summary
					class="{headingClass} {isNarrow
						? 'min-h-11 leading-[2.75rem]'
						: ''} cursor-pointer focus-ring"
				>
					Default view
				</summary>
				<label class="flex items-center justify-between gap-3 {isNarrow ? 'min-h-11' : ''}">
					<span class={captionClass}>Mine</span>
					<select
						aria-label="My default view"
						class="rounded-md border border-stone-300 bg-white px-1.5 py-1 focus-ring {isNarrow
							? 'min-h-11'
							: ''}"
						value={defaults.member ?? ''}
						onchange={(event) =>
							onSetMemberDefault?.((event.currentTarget.value || null) as LayoutMode | null)}
					>
						<option value=""
							>Tree default ({MODE_LABELS[defaults.tree ?? LAYOUT_MODES.FLAT]})</option
						>
						{#each Object.values(LAYOUT_MODES) as mode (mode)}
							<option value={mode}>{MODE_LABELS[mode]}</option>
						{/each}
					</select>
				</label>
				{#if defaults.canSetTree}
					<label class="flex items-center justify-between gap-3 {isNarrow ? 'min-h-11' : ''}">
						<span class={captionClass}>Everyone</span>
						<select
							aria-label="Default view for everyone"
							class="rounded-md border border-stone-300 bg-white px-1.5 py-1 focus-ring {isNarrow
								? 'min-h-11'
								: ''}"
							value={defaults.tree ?? LAYOUT_MODES.FLAT}
							onchange={(event) => onSetTreeDefault?.(event.currentTarget.value as LayoutMode)}
						>
							{#each Object.values(LAYOUT_MODES) as mode (mode)}
								<option value={mode}>{MODE_LABELS[mode]}</option>
							{/each}
						</select>
					</label>
				{/if}
				<p class="text-xs text-stone-600">Links that name a view still open in it.</p>
			</details>
		{/if}

		<button
			type="button"
			class="{controlClass} justify-center {isNarrow ? 'min-h-11' : ''}"
			disabled={changeCount === 0}
			onclick={() => onChange(displayDefaults(view.layoutMode))}
		>
			Reset to defaults
		</button>
	</div>
{/snippet}

<div
	class="flex items-center gap-x-3 gap-y-2 rounded-xl border border-[var(--tree-panel-border,#d6d3d1)] bg-[#fdfbf7] px-3 py-2 text-[13px] text-stone-900"
	role="toolbar"
	aria-label="Tree view controls"
	style={treeTokenStyle()}
>
	<Popover
		label="Focus person"
		class="min-w-0 {isNarrow ? 'flex-1' : 'shrink'}"
		panelClass="w-72 max-w-[calc(100vw-1.5rem)] py-1"
	>
		{#snippet trigger(attrs)}
			<button
				type="button"
				{...attrs}
				class="{controlClass} {isNarrow ? 'min-h-11 w-full justify-between' : 'max-w-full'}"
			>
				<span class="min-w-0 truncate">
					<span class="font-semibold">{focusPerson?.name ?? 'Choose a focus person'}</span>
					{#if partnerLabel}<span class="font-normal text-stone-600">
							with {partnerLabel}</span
						>{/if}
				</span>
				<ChevronDown class="h-3.5 w-3.5 shrink-0 text-stone-500" aria-hidden="true" />
			</button>
		{/snippet}
		{#if hasPartnerChoice}
			<div role="group" aria-label="Centred on partnership">
				<p class="px-3 pt-1.5 pb-1 {headingClass}">Centred on partnership</p>
				{#each unionChoices as choice (choice.id)}
					<button
						type="button"
						role="menuitemradio"
						aria-checked={choice.id === focusUnionId}
						class={itemClass}
						onclick={() => onChange({ unionId: choice.id })}
					>
						<span class="w-3.5 shrink-0 text-emerald-800" aria-hidden="true">
							{choice.id === focusUnionId ? '✓' : ''}
						</span>
						<span class="truncate">{choice.label}</span>
					</button>
				{/each}
			</div>
			<div role="separator" class="my-1 border-t border-stone-200"></div>
		{/if}
		<button type="button" role="menuitem" class={itemClass} onclick={onchangeFocus}>
			Change focus person…
		</button>
		{#if focusPerson}
			<button
				type="button"
				role="menuitem"
				class={itemClass}
				onclick={() => onopenProfile(focusPerson.id)}
			>
				<span class="truncate">Open {focusPerson.name}’s profile</span>
			</button>
		{/if}
	</Popover>

	{#if !isNarrow}
		<!-- Its own wrapping group: the chip shrinks and this wraps, so Display never drops alone onto a row. -->
		<div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
			{@render layoutControl()}
			<div class="flex items-center gap-3" role="group" aria-label="Generations">
				<span class={captionClass}>Generations</span>
				{@render stepper('Ancestors', 'ancestorDepth')}
				{@render stepper('Descendants', 'descendantDepth')}
			</div>
		</div>
	{/if}

	<Popover
		bind:isOpen={isDisplayOpen}
		role="dialog"
		align="end"
		class="ml-auto shrink-0"
		isSheet={isNarrow}
		label={isNarrow ? 'View options' : 'Display options'}
		panelClass={isNarrow ? '' : 'w-[22rem] max-w-[calc(100vw-1.5rem)] max-h-[75vh] overflow-y-auto'}
	>
		{#snippet trigger(attrs)}
			<button type="button" {...attrs} class="{controlClass} {isNarrow ? 'min-h-11' : ''}">
				<SlidersHorizontal class="h-3.5 w-3.5" aria-hidden="true" />
				{isNarrow ? 'View' : 'Display'}
				{#if changeCount > 0}
					<span
						class="rounded-full bg-emerald-800 px-1.5 text-[11px] leading-4 font-bold text-amber-50"
						aria-label="{changeCount} changed from the defaults">{changeCount}</span
					>
				{/if}
			</button>
		{/snippet}
		{@render displayPanel()}
	</Popover>
</div>
