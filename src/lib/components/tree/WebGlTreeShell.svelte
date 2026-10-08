<script lang="ts" generics="TScene extends WebGlTreeScene">
	import { onMount, untrack, type Snippet } from 'svelte';
	import { clearLabels, labelRank, type LabelBox } from './ring-labels.js';
	import { RING_TOKENS, treeTokenStyle } from './tree-tokens.js';
	import { yearsLine } from './tree-view.js';
	import {
		hoverCard,
		type LegendEntry,
		type ShellPerson,
		type TreeRole,
		type WebGlTreeScene
	} from './webgl-tree.js';

	/**
	 * The DOM half of every WebGL tree view: the person buttons over the canvas, announcements,
	 * keyboard, camera presets, Spin, All names, reduced motion and the WebGL-failure message. A
	 * mode's canvas component wraps it around its own scene module, which it supplies lazily.
	 */
	interface Props {
		/** Everyone drawn, for the name buttons. Private people are never named. */
		people: ShellPerson[];
		/** Roles on the focus line; whoever is absent is quiet until hovered or asked for. */
		roles: Map<string, TreeRole>;
		/** Accessible name of the whole view, such as "Generation rings". */
		label: string;
		/** What the view is called in the WebGL-failure message, such as "Rings". */
		viewName: string;
		/** Completes "Centre … on them." in each name button's accessible name, such as "the rings". */
		subject: string;
		/** Spoken when the focus or the counts change. */
		announcement: string;
		/** Changes when the view should be re-framed; see `TreeCanvas`. */
		fitKey: string;
		/** Camera presets, in button order; the first is the starting one. */
		cameras: ReadonlyArray<{ id: string; label: string }>;
		/**
		 * Fetches the mode's scene module and makes the scene; called once on mount. Import three.js
		 * inside it (`import('./x-scene.js')`) so only someone who opens the view pays for it. A
		 * rejection or a throw shows the WebGL-failure message.
		 */
		createScene: (host: HTMLElement) => Promise<TScene>;
		/**
		 * Draws the layout into the scene. Runs whenever the scene appears and whenever anything it
		 * reads changes, so read the layout inside it. `roles` are the ones to light: the view's own,
		 * or none when the viewer has cleared the highlight. `shouldRefit` is true when `fitKey`
		 * changed.
		 */
		applyLayout: (scene: TScene, roles: Map<string, TreeRole>, shouldRefit: boolean) => void;
		/** The scene once created; null before then and after a failure. */
		scene?: TScene | null;
		/** True under prefers-reduced-motion; a scene that animates anything decorative reads this. */
		shouldReduceMotion?: boolean;
		/** Person whose details are open in the drawer, if any. */
		selectedPersonId?: string | null;
		/** Legend entries, shown top left. */
		legend?: LegendEntry[];
		/** The one-line how-to beside the controls, on wide screens. */
		hint?: string;
		/** Extra buttons in the control panel, after Spin. Give them `class="view"`. */
		controls?: Snippet;
		/** A sphere or name was clicked or activated with Enter: refocus on them. */
		onSelectPerson?: (id: string) => void;
		/** Double-click or Shift+Enter on a person: open their details. */
		onOpenPerson?: (id: string) => void;
		/** Escape: drop the selection. */
		onClearSelection?: () => void;
	}

	let {
		people,
		roles,
		label,
		viewName,
		subject,
		announcement,
		fitKey,
		cameras,
		createScene,
		applyLayout,
		scene = $bindable(null),
		shouldReduceMotion = $bindable(false),
		selectedPersonId = null,
		legend = [],
		hint = 'Drag to orbit · scroll to zoom · right-drag to pan · click empty space to clear the highlight · double-click for details',
		controls,
		onSelectPerson,
		onOpenPerson,
		onClearSelection
	}: Props = $props();

	/** How far a name sits above its sphere's centre, in CSS pixels. */
	const NAME_LIFT_PX = 10;
	/** Pointer travel under which a press counts as a click rather than the start of an orbit. */
	const CLICK_SLOP_PX = 5;
	/** How far the hover card sits from the pointer, in CSS pixels. */
	const CARD_OFFSET_PX = 14;

	let host = $state<HTMLDivElement>();
	let didFail = $state(false);
	let camera = $state(untrack(() => cameras[0].id));
	let isSpinning = $state(false);
	let shouldShowAllNames = $state(false);
	let hoveredId = $state<string | null>(null);
	/**
	 * The roles the viewer cleared the highlight on. Clearing keeps everyone where they are and only
	 * stops lighting the focus line; a new focus (a new roles map) lights its line again.
	 */
	let clearedRoles = $state.raw<Map<string, TreeRole> | null>(null);
	const isHighlightCleared = $derived(clearedRoles === roles);
	const NO_ROLES = new Map<string, TreeRole>();
	/** The roles the scene and the names show. */
	const shownRoles = $derived(isHighlightCleared ? NO_ROLES : roles);
	function clearHighlight() {
		clearedRoles = roles;
	}
	/** The pointer inside the canvas, in CSS pixels; null while orbiting or off the canvas. */
	let pointerAt = $state<{ x: number; y: number } | null>(null);
	let shellWidth = $state(0);
	let shellHeight = $state(0);
	let cardWidth = $state(0);
	let cardHeight = $state(0);

	const personById = $derived(new Map(people.map((p) => [p.id, p])));
	const hovered = $derived(hoveredId ? personById.get(hoveredId) : undefined);
	const card = $derived(
		hovered && hovered.person.isPrivate !== true
			? hoverCard(hovered.person, people, shownRoles.get(hovered.id) ?? null)
			: null
	);
	/** Below and right of the pointer, flipped to the other side where it would leave the view. */
	const cardAt = $derived.by(() => {
		if (!pointerAt) return null;
		const x =
			pointerAt.x + CARD_OFFSET_PX + cardWidth > shellWidth
				? pointerAt.x - CARD_OFFSET_PX - cardWidth
				: pointerAt.x + CARD_OFFSET_PX;
		const y =
			pointerAt.y + CARD_OFFSET_PX + cardHeight > shellHeight
				? pointerAt.y - CARD_OFFSET_PX - cardHeight
				: pointerAt.y + CARD_OFFSET_PX;
		return { x: Math.max(4, x), y: Math.max(4, y) };
	});
	function sexColourOf(person: ShellPerson['person']): string {
		if (person.sex === 'M') return RING_TOKENS.male;
		if (person.sex === 'F') return RING_TOKENS.female;
		return RING_TOKENS.unknownSex;
	}

	/**
	 * Names on screen: the focus line, whoever the pointer is over and the open drawer. Every name at
	 * once crowds a view of more than a dozen, so that is a switch, not the default.
	 */
	const named = $derived(
		people.filter(
			(p) =>
				p.person.isPrivate !== true &&
				(shouldShowAllNames ||
					shownRoles.has(p.id) ||
					p.id === hoveredId ||
					p.id === selectedPersonId)
		)
	);

	const tags = new Map<string, HTMLElement>();
	/** Name sizes, measured once: the text never changes while the element lives. */
	const sizes = new WeakMap<HTMLElement, { width: number; height: number }>();
	const generationOf = $derived(new Map(people.map((p) => [p.id, p.generation])));
	/** Keeps a name's element where the frame loop can move it with its sphere. */
	function tracked(id: string) {
		return (element: HTMLElement) => {
			tags.set(id, element);
			scene?.requestFrame();
			return () => {
				if (tags.get(id) === element) tags.delete(id);
				scene?.requestFrame();
			};
		};
	}
	/**
	 * Moves every name to its sphere, then hides those that would cover a more important one. A
	 * hidden name stays in the tab order and shows while focused, so the keyboard still reaches it.
	 */
	function placeNames() {
		if (!scene) return;
		const boxes: Array<LabelBox & { rank: number }> = [];
		for (const [id, element] of tags) {
			const at = scene.project(id);
			element.style.visibility = at ? 'visible' : 'hidden';
			if (!at) continue;
			let size = sizes.get(element);
			if (!size) {
				size = { width: element.offsetWidth, height: element.offsetHeight };
				sizes.set(element, size);
			}
			const left = at.x - size.width / 2;
			const top = at.y - size.height - NAME_LIFT_PX;
			element.style.translate = `${left}px ${top}px`;
			boxes.push({
				id,
				left,
				top,
				...size,
				rank: labelRank(shownRoles.get(id) ?? null, generationOf.get(id) ?? 0, {
					isHovered: id === hoveredId,
					isSelected: id === selectedPersonId
				})
			});
		}
		const shown = clearLabels(boxes.sort((a, b) => a.rank - b.rank));
		for (const { id } of boxes) tags.get(id)?.classList.toggle('is-crowded', !shown.has(id));
	}

	onMount(() => {
		const motion = matchMedia('(prefers-reduced-motion: reduce)');
		shouldReduceMotion = motion.matches;
		const onMotion = (event: MediaQueryListEvent) => {
			shouldReduceMotion = event.matches;
			if (event.matches) isSpinning = false;
		};
		motion.addEventListener('change', onMotion);
		let isDisposed = false;
		let created: TScene | null = null;
		createScene(host!)
			.then((made) => {
				if (isDisposed) {
					made.dispose();
					return;
				}
				created = made;
				made.onFrame(placeNames);
				scene = made;
			})
			.catch(() => (didFail = true));
		return () => {
			isDisposed = true;
			motion.removeEventListener('change', onMotion);
			created?.dispose();
		};
	});

	let lastFitKey: string | null = null;
	$effect(() => {
		if (!scene) return;
		const shouldRefit = fitKey !== lastFitKey;
		lastFitKey = fitKey;
		applyLayout(scene, shownRoles, shouldRefit);
	});
	$effect(() => {
		scene?.setCamera(camera);
	});
	// The pointer and the drawer win a crowded spot, so a change to either re-sorts the names.
	$effect(() => {
		void hoveredId;
		void selectedPersonId;
		scene?.requestFrame();
	});
	$effect(() => {
		scene?.setSpinning(isSpinning && !shouldReduceMotion);
	});

	let downAt: { x: number; y: number } | null = null;
	const isClick = (event: PointerEvent | MouseEvent) =>
		downAt !== null &&
		Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) <= CLICK_SLOP_PX;

	function onPointerDown(event: PointerEvent) {
		downAt = { x: event.clientX, y: event.clientY };
	}
	function onPointerUp(event: PointerEvent) {
		if (!scene || !isClick(event) || event.button !== 0) return;
		const id = scene.pick(event.clientX, event.clientY);
		if (id) selectPerson(id);
		else clearHighlight();
	}
	function onDoubleClick(event: MouseEvent) {
		const id = scene?.pick(event.clientX, event.clientY);
		if (id) onOpenPerson?.(id);
	}
	function onPointerMove(event: PointerEvent) {
		// Touch has no hover; a name appearing under a finger mid-orbit only gets in the way.
		if (event.pointerType !== 'mouse' || !scene) return;
		// A pressed button is an orbit or a pan; a card chasing the drag hides the scene it moves.
		if (event.buttons !== 0) {
			pointerAt = null;
			return;
		}
		const bounds = host!.getBoundingClientRect();
		pointerAt = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
		const id = scene.pick(event.clientX, event.clientY);
		if (id !== untrack(() => hoveredId)) hoveredId = id;
	}
	function selectPerson(id: string) {
		clearedRoles = null;
		onSelectPerson?.(id);
	}
	function onTagKey(event: KeyboardEvent, id: string) {
		if (event.key === 'Enter' && event.shiftKey) {
			event.preventDefault();
			onOpenPerson?.(id);
		}
	}
</script>

<svelte:window
	onkeydown={(event) => {
		if (event.key !== 'Escape') return;
		// One step back at a time: an open drawer closes first, then the highlight clears.
		if (selectedPersonId) onClearSelection?.();
		else clearHighlight();
	}}
/>

<div
	class="webgl-shell relative flex-1 overflow-hidden rounded-2xl border border-[var(--tree-panel-border)]"
	style="{treeTokenStyle()};--ring-partner:{RING_TOKENS.partner};background:{RING_TOKENS.stage}"
	role="group"
	aria-label={label}
	bind:clientWidth={shellWidth}
	bind:clientHeight={shellHeight}
>
	<!-- Pointer only: the names below are the keyboard route to everyone in the view. -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		bind:this={host}
		class="absolute inset-0 touch-none"
		class:cursor-pointer={hoveredId !== null}
		onpointerdown={onPointerDown}
		onpointerup={onPointerUp}
		onpointermove={onPointerMove}
		onpointerleave={() => {
			hoveredId = null;
			pointerAt = null;
		}}
		ondblclick={onDoubleClick}
	></div>

	{#if scene}
		<div class="pointer-events-none absolute inset-0 z-10">
			{#each named as p (p.id)}
				{@const role = shownRoles.get(p.id) ?? null}
				{@const years = yearsLine(p.person)}
				<button
					type="button"
					class="tag"
					class:is-focus={role === 'focus'}
					class:is-ancestor={role === 'ancestor'}
					class:is-descendant={role === 'descendant'}
					class:is-partner={role === 'partner'}
					class:is-selected={p.id === selectedPersonId}
					aria-label="{p.person.displayName}{years ? `, ${years}` : ''}. Centre {subject} on them."
					onclick={() => selectPerson(p.id)}
					ondblclick={() => onOpenPerson?.(p.id)}
					onkeydown={(event) => onTagKey(event, p.id)}
					{@attach tracked(p.id)}
				>
					{p.person.displayName}
				</button>
			{/each}
		</div>
	{/if}

	{#if card && hovered && cardAt}
		{@const years = yearsLine(hovered.person)}
		<!-- Pointer only, so hidden from assistive tech: a name's own label carries its years. -->
		<div
			class="hover-card pointer-events-none absolute top-0 left-0 z-30"
			style="translate:{cardAt.x}px {cardAt.y}px"
			aria-hidden="true"
			data-testid="hover-card"
			bind:offsetWidth={cardWidth}
			bind:offsetHeight={cardHeight}
		>
			<p class="name">{card.name}</p>
			{#if years}<p class="years">{years}</p>{/if}
			<p class="meta">
				<i style="background:{sexColourOf(hovered.person)}"></i>{card.sex}{#if card.roleLabel}<span
						class="sep">·</span
					>{card.roleLabel}{/if}
			</p>
			<p class="meta">
				{card.partnershipCount}
				{card.partnershipCount === 1 ? 'partnership' : 'partnerships'}<span class="sep">·</span
				>{card.childrenInView}
				{card.childrenInView === 1 ? 'child' : 'children'} in view
			</p>
			<p class="hint">Click to centre · double-click for details</p>
		</div>
	{/if}

	{#if didFail}
		<div class="absolute inset-0 z-10 flex items-center justify-center p-6 text-center">
			<p class="max-w-sm text-sm text-stone-700">
				{viewName} needs WebGL, which this browser has turned off or does not support. Flat shows the
				same people.
			</p>
		</div>
	{:else if people.length === 0}
		<div class="absolute inset-0 z-10 flex items-center justify-center">
			<p class="text-base font-medium text-stone-700">No people in this tree yet.</p>
		</div>
	{/if}

	<div class="legend absolute top-4 left-4 z-20" aria-hidden="true">
		{#each legend as entry (entry.label)}
			<span>
				{#if entry.kind === 'line'}
					<b style="background:{entry.colour}"></b>
				{:else if entry.kind === 'halo'}
					<i class="halo" style="border-color:{entry.colour}"></i>
				{:else}
					<i style="background:{entry.colour}"></i>
				{/if}
				{entry.label}
			</span>
		{/each}
	</div>

	<div
		class="pointer-events-none absolute inset-x-3 bottom-4 z-20 flex flex-wrap items-end justify-between gap-2 sm:inset-x-6 sm:bottom-6"
	>
		<div
			class="pointer-events-auto flex flex-wrap items-center gap-2 rounded-xl border border-[var(--tree-panel-border)] bg-[var(--tree-panel)] p-1.5 text-xs shadow-md"
		>
			<div class="flex items-center gap-1" role="group" aria-label="Camera">
				{#each cameras as option (option.id)}
					<button
						type="button"
						class="view"
						aria-pressed={camera === option.id}
						onclick={() => (camera = option.id)}
					>
						{option.label}
					</button>
				{/each}
			</div>
			<button
				type="button"
				class="view"
				aria-pressed={shouldShowAllNames}
				onclick={() => (shouldShowAllNames = !shouldShowAllNames)}
			>
				All names
			</button>
			<button
				type="button"
				class="view"
				aria-pressed={!isHighlightCleared}
				onclick={() => (isHighlightCleared ? (clearedRoles = null) : clearHighlight())}
			>
				Focus line
			</button>
			{#if !shouldReduceMotion}
				<button
					type="button"
					class="view"
					aria-pressed={isSpinning}
					onclick={() => (isSpinning = !isSpinning)}
				>
					Spin
				</button>
			{/if}
			{@render controls?.()}
		</div>
		<p
			class="hidden rounded-full border border-[var(--tree-panel-border)] bg-[var(--tree-panel)] px-3 py-1 text-xs text-stone-600 shadow-sm sm:block"
		>
			{hint}
		</p>
	</div>

	<p class="sr-only" aria-live="polite">
		{isHighlightCleared ? 'Highlight cleared: everyone is shown alike.' : announcement}
	</p>
</div>

<style>
	.tag {
		position: absolute;
		top: 0;
		left: 0;
		pointer-events: auto;
		white-space: nowrap;
		border: 1px solid var(--tree-panel-border);
		border-radius: 0.375rem;
		background: color-mix(in srgb, var(--tree-panel) 92%, transparent);
		padding: 0.0625rem 0.375rem;
		font-size: 0.75rem;
		line-height: 1.25;
		color: var(--tree-ink);
		cursor: pointer;
	}
	.tag.is-ancestor {
		border-color: var(--union-ink);
	}
	.tag.is-descendant {
		border-color: var(--tree-accent);
	}
	.tag.is-partner {
		border-color: var(--ring-partner);
	}
	.tag.is-focus {
		background: var(--tree-ink);
		border-color: var(--tree-ink);
		color: var(--tree-panel);
		font-weight: 600;
	}
	/* Crowded out by a more important name (set from the frame loop, hence global); focus brings it
	   back so the keyboard still finds it. */
	.tag:global(.is-crowded) {
		opacity: 0;
		pointer-events: none;
	}
	.tag:global(.is-crowded):focus-visible {
		opacity: 1;
	}
	.tag.is-selected {
		box-shadow: 0 0 0 2px var(--tree-focus-ring);
	}
	.tag:focus-visible {
		outline: 2px solid var(--tree-focus-ring);
		outline-offset: 2px;
		z-index: 1;
	}
	.hover-card {
		max-width: 16rem;
		border: 1px solid var(--tree-panel-border);
		border-left: 3px solid var(--color-emerald-800);
		border-radius: 0.625rem;
		background: var(--tree-panel);
		padding: 0.5rem 0.75rem;
		font-size: 0.75rem;
		line-height: 1.35;
		color: var(--tree-ink-muted);
		box-shadow: 0 8px 24px -8px rgb(28 25 23 / 0.35);
	}
	.hover-card .name {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--tree-ink);
	}
	.hover-card .years {
		color: var(--tree-ink);
	}
	.hover-card .meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		margin-top: 0.125rem;
	}
	.hover-card .meta i {
		display: inline-block;
		width: 0.5rem;
		height: 0.5rem;
		margin-right: 0.3125rem;
		border-radius: 9999px;
	}
	.hover-card .sep {
		margin: 0 0.3125rem;
	}
	.hover-card .hint {
		margin-top: 0.3125rem;
		font-size: 0.6875rem;
		color: var(--color-emerald-800);
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		max-width: calc(100% - 2rem);
		border: 1px solid var(--tree-panel-border);
		border-radius: 0.75rem;
		background: var(--tree-panel);
		padding: 0.375rem 0.625rem;
		font-size: 0.75rem;
		color: var(--tree-ink-muted);
	}
	/* Flex, so the whitespace between the swatch and its label in the markup takes no width. */
	.legend span {
		display: inline-flex;
		align-items: center;
	}
	.legend i.halo {
		background: transparent;
		border: 2px solid;
	}
	.legend b {
		display: inline-block;
		width: 1rem;
		height: 0.1875rem;
		margin-right: 0.3125rem;
		border-radius: 9999px;
		vertical-align: 0.1875rem;
	}
	.legend i {
		display: inline-block;
		width: 0.625rem;
		height: 0.625rem;
		margin-right: 0.3125rem;
		border-radius: 9999px;
		vertical-align: -0.0625rem;
	}
	/* The same camera buttons as Layers, so the 3D views read as one family of controls. */
	/* Global, so a mode's extra controls (a snippet from the canvas) can wear the same buttons. */
	.webgl-shell :global(.view) {
		padding: 0.25rem 0.625rem;
		border-radius: 0.5rem;
		border: 1px solid var(--tree-panel-border);
		color: #44403c;
		font-weight: 600;
		cursor: pointer;
	}
	.webgl-shell :global(.view[aria-pressed='true']) {
		background: var(--color-emerald-800);
		border-color: var(--color-emerald-800);
		color: var(--color-amber-50);
	}
	.webgl-shell :global(.view:focus-visible) {
		outline: 2px solid var(--tree-focus-ring);
		outline-offset: 2px;
	}
</style>
