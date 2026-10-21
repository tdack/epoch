<script lang="ts">
	import { ArrowDown, ArrowUp, ChevronDown, Minus, Plus, SlidersHorizontal } from '@lucide/svelte';
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
	import {
		LAYOUT_MODE_VALUES,
		MODE_LABELS,
		VIEW_MODE_TRAITS,
		WEBGL_LAYOUT_MODES,
		parseLayoutMode
	} from '#lib/shared/view-mode.js';
	import { DEFAULT_PALETTE, treeTokenStyle, type Palette } from '#lib/shared/palette.js';
	import { RELATIONSHIP_STYLES } from './tree-view.js';

	interface Props {
		/** The current view; the toolbar reports changes and does not keep its own copy. */
		view: TreeViewState;
		/** The colours to paint with, so the toolbar's focus chips match the canvas. */
		palette?: Palette;
		/** The person the chart is centred on; null before the graph has one. */
		focusPerson?: { id: string; name: string } | null;
		/** Move keyboard focus to the header's person finder, where the focus person is changed. */
		onchangeFocus: () => void;
		/** Open the focus person's profile page. */
		onopenProfile: (personId: string) => void;
		/**
		 * Open the focus person's details beside the chart. The canvas reaches them by double-click or
		 * long-press; this is the route that needs neither, and that a touch screen can see.
		 */
		onshowDetails?: (personId: string) => void;
		/** The viewer's own saved view for this tree, when it can be changed here. */
		defaults?: { member: LayoutMode | null };
		/** Save the viewer's own default view; null clears it so Flat applies. */
		onSetMemberDefault?: (mode: LayoutMode | null) => void;
		/** Merge these fields into the view. */
		onChange: (change: Partial<TreeViewState>) => void;
	}

	let {
		view,
		palette = DEFAULT_PALETTE,
		focusPerson = null,
		onchangeFocus,
		onopenProfile,
		onshowDetails,
		defaults,
		onSetMemberDefault,
		onChange
	}: Props = $props();

	/** What each layout draws, in a relative's words: the labels alone were the tool's own names. */
	const MODE_DESCRIPTIONS: Record<LayoutMode, string> = {
		flat: 'Everyone on one page: ancestors above, descendants below.',
		rings:
			'An overview to turn and explore: one ring for each generation, the youngest at the top and the oldest at the bottom, with lines up to the children.',
		poincare:
			'A glass ball with the family inside it. Height is the calendar, the oldest at the top; the wider a generation, the nearer its people sit to the glass.',
		ribbons:
			'Each person is a ribbon of descent. A couple’s ribbons meet at a glowing knot, and their children’s ribbons branch out from it like a river delta.',
		orrery:
			'A star cluster. Partners circle each other as a pair of stars, and their children circle the pair.'
	};
	const uid = $props.id();
	const hintId = (title: string) => `${uid}-${title.replace(/\W+/g, '-')}-hint`;
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

	/**
	 * Below this width the two depth steppers fold into one Generations button, so a tablet keeps
	 * the toolbar to one row instead of stacking them and taking the height from the canvas.
	 */
	const COMPACT_MAX_WIDTH_PX = 1023;
	let isCompact = $state(false);
	$effect(() => {
		const query = matchMedia(`(max-width: ${COMPACT_MAX_WIDTH_PX}px)`);
		isCompact = query.matches;
		const onQueryChange = (event: MediaQueryListEvent) => (isCompact = event.matches);
		query.addEventListener('change', onQueryChange);
		return () => query.removeEventListener('change', onQueryChange);
	});

	/** The segments beside the 3D button: Flat. */
	const plainModes = LAYOUT_MODE_VALUES.filter((mode) => !VIEW_MODE_TRAITS[mode].isWebGl);

	const LAST_3D_KEY = 'epoch:last-3d-view';
	/** The 3D view the 3D button returns to: the one in force, else the last one used, else Rings. */
	let rememberedMode = $state<LayoutMode>(LAYOUT_MODES.RINGS);
	let isPickerOpen = $state(false);
	$effect(() => {
		try {
			const stored = parseLayoutMode(localStorage.getItem(LAST_3D_KEY));
			if (stored && WEBGL_LAYOUT_MODES.includes(stored)) rememberedMode = stored;
		} catch {
			// Storage can be blocked; the 3D button then simply starts at Rings.
		}
	});
	const threeDMode = $derived(
		VIEW_MODE_TRAITS[view.layoutMode].isWebGl ? view.layoutMode : rememberedMode
	);
	function chooseThreeD(mode: LayoutMode) {
		rememberedMode = mode;
		try {
			localStorage.setItem(LAST_3D_KEY, mode);
		} catch {
			// The choice still applies for this visit.
		}
		isPickerOpen = false;
		onChange({ layoutMode: mode });
	}
	const changeCount = $derived(countDisplayChanges(view));
	const canShowWiderGroups = $derived(VIEW_MODE_TRAITS[view.layoutMode].hasWiderGroups);

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
		'inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-stone-800 shadow-xs hover:bg-stone-100 focus-ring coarse:min-h-11';
	const captionClass = 'text-xs font-semibold text-stone-600';
	const headingClass = 'text-xs font-bold tracking-wide text-stone-600 uppercase';
	const hintClass = 'pb-1 text-xs leading-snug text-stone-600';
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
			disabled={view.isWholeTree || view[field] <= 0}
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
			disabled={view.isWholeTree || view[field] >= MAX_DEPTH}
			onclick={() => setDepth(field, view[field] + 1)}
		>
			<Plus class="h-3.5 w-3.5" />
		</button>
	</div>
{/snippet}

{#snippet layoutControl()}
	{@const segmentClass = (isOn: boolean) =>
		`cursor-pointer px-3 text-xs font-semibold focus-ring-inset ${
			isNarrow ? 'min-h-11 flex-1' : 'py-1.5 coarse:min-h-11'
		} ${
			isOn
				? 'bg-emerald-800 text-amber-50 focus-visible:outline-amber-50'
				: 'text-stone-800 hover:bg-stone-100'
		}`}
	<!-- Focus leaving the whole control closes the picker; Escape closes it without closing a sheet. -->
	<div
		class="relative {isNarrow ? 'w-full' : ''}"
		role="presentation"
		onfocusout={(event) => {
			if (!event.currentTarget.contains(event.relatedTarget as Node | null)) isPickerOpen = false;
		}}
		onkeydown={(event) => {
			if (event.key === 'Escape' && isPickerOpen) {
				event.stopPropagation();
				isPickerOpen = false;
			}
		}}
	>
		<div
			class="inline-flex overflow-hidden rounded-lg border border-stone-300 bg-white {isNarrow
				? 'flex w-full'
				: ''}"
			role="group"
			aria-label="Layout"
		>
			{#each plainModes as mode (mode)}
				<button
					type="button"
					class={segmentClass(view.layoutMode === mode)}
					aria-pressed={view.layoutMode === mode}
					onclick={() => onChange({ layoutMode: mode })}
				>
					{MODE_LABELS[mode]}
				</button>
			{/each}
			<button
				type="button"
				class="{segmentClass(VIEW_MODE_TRAITS[view.layoutMode].isWebGl)} {isNarrow
					? 'flex-[2]'
					: ''}"
				aria-pressed={VIEW_MODE_TRAITS[view.layoutMode].isWebGl}
				onclick={() => chooseThreeD(threeDMode)}
			>
				3D · {MODE_LABELS[threeDMode]}
			</button>
			<button
				type="button"
				class="{segmentClass(false)} border-l border-stone-300 px-2"
				aria-label="Choose the 3D view"
				aria-expanded={isPickerOpen}
				onclick={() => (isPickerOpen = !isPickerOpen)}
			>
				<ChevronDown class="h-3.5 w-3.5" aria-hidden="true" />
			</button>
		</div>
		{#if isPickerOpen}
			<div
				class="z-30 mt-1 grid gap-0.5 rounded-lg border border-stone-300 bg-[#fdfbf7] p-1 shadow-md {isNarrow
					? ''
					: 'absolute top-full left-0 w-72 max-w-[calc(100vw-1.5rem)]'}"
				role="group"
				aria-label="3D view"
			>
				{#each WEBGL_LAYOUT_MODES as mode (mode)}
					<button
						type="button"
						class="flex menu-item w-full cursor-pointer flex-col rounded-md px-2.5 text-left focus-ring {isNarrow
							? 'min-h-11 py-1.5'
							: 'py-1.5 coarse:min-h-11'}"
						aria-pressed={view.layoutMode === mode}
						onclick={() => chooseThreeD(mode)}
					>
						<span class="text-xs font-semibold text-stone-900"
							>{MODE_LABELS[mode]}{view.layoutMode === mode ? ' ✓' : ''}</span
						>
						<span class="text-xs leading-snug font-normal text-stone-600"
							>{MODE_DESCRIPTIONS[mode]}</span
						>
					</button>
				{/each}
			</div>
		{/if}
	</div>
{/snippet}

{#snippet toggle(
	title: string,
	isChecked: boolean,
	onToggle: (checked: boolean) => void,
	hint?: string
)}
	<label class="{rowClass} cursor-pointer text-xs">
		<input
			type="checkbox"
			class="focus-ring {isNarrow ? 'h-5 w-5' : 'coarse:h-5 coarse:w-5'}"
			checked={isChecked}
			onchange={(e) => onToggle(e.currentTarget.checked)}
			aria-describedby={hint ? hintId(title) : undefined}
		/>
		{title}
	</label>
	{#if hint}
		<p id={hintId(title)} class="{hintClass} pl-7">{hint}</p>
	{/if}
{/snippet}

{#snippet sideBranches()}
	<div
		class={rowClass}
		role="group"
		aria-label="Relatives off the direct line"
		aria-describedby="{uid}-side-branches-hint"
	>
		<span class={captionClass}>Side branches</span>
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
	<p id="{uid}-side-branches-hint" class={hintClass}>
		How far out to draw aunts, uncles, cousins and their partners.
	</p>
{/snippet}

{#snippet displayPanel()}
	<div class="grid gap-3 text-xs {isNarrow ? '' : 'p-3'}">
		{#if isNarrow}
			<section class="grid gap-1">
				<h3 class={headingClass}>Layout</h3>
				{@render layoutControl()}
				<p class={hintClass}>{MODE_DESCRIPTIONS[view.layoutMode]}</p>
			</section>
			<section class="grid gap-1">
				<h3 class={headingClass}>Generations</h3>
				{@render stepper('Ancestors', 'ancestorDepth')}
				{@render stepper('Descendants', 'descendantDepth')}
				{#if view.isWholeTree}<p class={hintClass}>The whole tree shows every generation.</p>{/if}
			</section>
		{/if}

		{#if !isNarrow}
			<p class={hintClass}>
				<span class="font-semibold text-stone-800">{MODE_LABELS[view.layoutMode]}:</span>
				{MODE_DESCRIPTIONS[view.layoutMode]}
			</p>
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
					Open this tree in
				</summary>
				<label class="flex items-center justify-between gap-3 {isNarrow ? 'min-h-11' : ''}">
					<span class={captionClass}>Mine</span>
					<select
						aria-label="Open this tree in"
						class="rounded-md border border-stone-300 bg-white px-1.5 py-1 focus-ring {isNarrow
							? 'min-h-11'
							: ''}"
						value={defaults.member ?? ''}
						onchange={(event) =>
							onSetMemberDefault?.((event.currentTarget.value || null) as LayoutMode | null)}
					>
						<option value="">Flat (the default)</option>
						{#each LAYOUT_MODE_VALUES as mode (mode)}
							<option value={mode}>{MODE_LABELS[mode]}</option>
						{/each}
					</select>
				</label>
				<p class="text-xs text-stone-600">Links that name a view still open in it.</p>
			</details>
		{/if}

		<button
			type="button"
			class="{controlClass} justify-center disabled:cursor-default disabled:opacity-50 disabled:hover:bg-white {isNarrow
				? 'min-h-11'
				: ''}"
			disabled={changeCount === 0}
			onclick={() => onChange(displayDefaults(view.layoutMode))}
		>
			Reset display
		</button>
	</div>
{/snippet}

<div
	class="flex items-center gap-x-3 gap-y-2 rounded-xl border border-[var(--tree-panel-border,#d6d3d1)] bg-[#fdfbf7] px-3 py-2 text-xs text-stone-900"
	role="toolbar"
	aria-label="Tree view controls"
	style={treeTokenStyle(palette)}
>
	<Popover
		label="Focus person"
		class="min-w-0 {isNarrow ? 'flex-1' : 'max-w-[18rem] shrink'}"
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
				</span>
				<ChevronDown class="h-3.5 w-3.5 shrink-0 text-stone-500" aria-hidden="true" />
			</button>
		{/snippet}
		<button type="button" role="menuitem" class={itemClass} onclick={onchangeFocus}>
			Change focus person…
		</button>
		{#if focusPerson && onshowDetails}
			<button
				type="button"
				role="menuitem"
				class={itemClass}
				onclick={() => onshowDetails(focusPerson.id)}
			>
				<span class="truncate">Show {focusPerson.name}’s details</span>
			</button>
		{/if}
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
			{#if isCompact}
				<Popover label="Generations" role="dialog" panelClass="w-64 p-3">
					{#snippet trigger(attrs)}
						<button type="button" {...attrs} class={controlClass}>
							<span class={captionClass}>Generations</span>
							{#if view.isWholeTree}
								<span class="font-bold">All</span>
							{:else}
								<span class="inline-flex items-center font-bold tabular-nums" aria-hidden="true">
									<ArrowUp class="h-3 w-3" />{view.ancestorDepth}
									<ArrowDown class="ml-1 h-3 w-3" />{view.descendantDepth}
								</span>
								<span class="sr-only">{view.ancestorDepth} up, {view.descendantDepth} down</span>
							{/if}
							<ChevronDown class="h-3.5 w-3.5 shrink-0 text-stone-500" aria-hidden="true" />
						</button>
					{/snippet}
					<div class="grid gap-1">
						{@render stepper('Ancestors', 'ancestorDepth')}
						{@render stepper('Descendants', 'descendantDepth')}
						{#if view.isWholeTree}<p class={hintClass}>
								The whole tree shows every generation.
							</p>{/if}
					</div>
				</Popover>
			{:else}
				<div
					class="flex flex-wrap items-center gap-x-3 gap-y-2"
					role="group"
					aria-label="Generations"
				>
					<span class={captionClass}>Generations</span>
					{@render stepper('Ancestors', 'ancestorDepth')}
					{@render stepper('Descendants', 'descendantDepth')}
					{#if view.isWholeTree}<span class={hintClass}>The whole tree shows every generation.</span
						>{/if}
				</div>
			{/if}
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
