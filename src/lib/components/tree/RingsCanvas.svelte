<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { ringLineage, type RingsLayout } from '#lib/tree-layout/rings.js';
	import { clearLabels, labelRank, type LabelBox } from './ring-labels.js';
	import type { RingCamera, RingRole, RingsScene } from './rings-scene.js';
	import { RING_TOKENS, treeTokenStyle } from './tree-tokens.js';
	import { yearsLine } from './tree-view.js';

	interface Props {
		/** Rings, people and lines from `layoutRings`. */
		layout: RingsLayout;
		/** Changes when the view should be re-framed; see `TreeCanvas`. */
		fitKey: string;
		/** Person whose details are open in the drawer, if any. */
		selectedPersonId?: string | null;
		/** A sphere or name was clicked or activated with Enter: refocus the rings on them. */
		onSelectPerson?: (id: string) => void;
		/** Double-click or Shift+Enter on a person: open their details. */
		onOpenPerson?: (id: string) => void;
		/** Escape: drop the selection. */
		onClearSelection?: () => void;
	}

	let {
		layout,
		fitKey,
		selectedPersonId = null,
		onSelectPerson,
		onOpenPerson,
		onClearSelection
	}: Props = $props();

	const CAMERA_LABELS: Record<RingCamera, string> = {
		angled: 'Angled',
		side: 'Side',
		above: 'Above'
	};
	/** How far a name sits above its sphere's centre, in CSS pixels. */
	const NAME_LIFT_PX = 10;
	/** Pointer travel under which a press counts as a click rather than the start of an orbit. */
	const CLICK_SLOP_PX = 5;

	let host = $state<HTMLDivElement>();
	let scene = $state.raw<RingsScene | null>(null);
	let didFail = $state(false);
	let camera = $state<RingCamera>('angled');
	let isSpinning = $state(false);
	let shouldShowAllNames = $state(false);
	let hoveredId = $state<string | null>(null);
	let shouldReduceMotion = $state(false);

	const lineage = $derived(ringLineage(layout, layout.focusPersonId));
	const roles = $derived.by(() => {
		const map = new Map<string, RingRole>();
		for (const id of lineage.partnerIds) map.set(id, 'partner');
		for (const id of lineage.descendantIds) map.set(id, 'descendant');
		for (const id of lineage.ancestorIds) map.set(id, 'ancestor');
		map.set(layout.focusPersonId, 'focus');
		return map;
	});
	const focus = $derived(layout.people.find((p) => p.id === layout.focusPersonId));
	/**
	 * Names on screen: the focus line, whoever the pointer is over and the open drawer. Every name at
	 * once crowds a ring of more than a dozen, so that is a switch, not the default.
	 */
	const named = $derived(
		layout.people.filter(
			(p) =>
				p.person.isPrivate !== true &&
				(shouldShowAllNames || roles.has(p.id) || p.id === hoveredId || p.id === selectedPersonId)
		)
	);
	const announcement = $derived(
		focus
			? `Rings centred on ${focus.person.displayName}: ${lineage.ancestorIds.size} ancestors and ${lineage.descendantIds.size} descendants shown across ${layout.rings.length} generations.`
			: ''
	);

	const tags = new Map<string, HTMLElement>();
	/** Name sizes, measured once: the text never changes while the element lives. */
	const sizes = new WeakMap<HTMLElement, { width: number; height: number }>();
	const generationOf = $derived(new Map(layout.people.map((p) => [p.id, p.generation])));
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
				rank: labelRank(roles.get(id) ?? null, generationOf.get(id) ?? 0, {
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
		let created: RingsScene | null = null;
		// three.js is fetched here, not with the page, so only someone who opens Rings pays for it.
		import('./rings-scene.js')
			.then(({ createRingsScene }) => {
				if (isDisposed || !host) return;
				try {
					created = createRingsScene(host);
				} catch {
					didFail = true;
					return;
				}
				created.onFrame(placeNames);
				scene = created;
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
		scene.setLayout(layout, roles, shouldRefit);
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
		if (id) onSelectPerson?.(id);
	}
	function onDoubleClick(event: MouseEvent) {
		const id = scene?.pick(event.clientX, event.clientY);
		if (id) onOpenPerson?.(id);
	}
	function onPointerMove(event: PointerEvent) {
		// Touch has no hover; a name appearing under a finger mid-orbit only gets in the way.
		if (event.pointerType !== 'mouse' || !scene) return;
		const id = scene.pick(event.clientX, event.clientY);
		if (id !== untrack(() => hoveredId)) hoveredId = id;
	}
	function onTagKey(event: KeyboardEvent, id: string) {
		if (event.key === 'Enter' && event.shiftKey) {
			event.preventDefault();
			onOpenPerson?.(id);
		}
	}
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && onClearSelection?.()} />

<div
	class="relative flex-1 overflow-hidden rounded-2xl border border-[var(--tree-panel-border)]"
	style="{treeTokenStyle()};--ring-partner:{RING_TOKENS.partner};background:{RING_TOKENS.stage}"
	role="group"
	aria-label="Generation rings"
>
	<!-- Pointer only: the names below are the keyboard route to everyone on the rings. -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		bind:this={host}
		class="absolute inset-0 touch-none"
		class:cursor-pointer={hoveredId !== null}
		onpointerdown={onPointerDown}
		onpointerup={onPointerUp}
		onpointermove={onPointerMove}
		onpointerleave={() => (hoveredId = null)}
		ondblclick={onDoubleClick}
	></div>

	{#if scene}
		<div class="pointer-events-none absolute inset-0 z-10">
			{#each named as p (p.id)}
				{@const role = roles.get(p.id) ?? null}
				{@const years = yearsLine(p.person)}
				<button
					type="button"
					class="tag"
					class:is-focus={role === 'focus'}
					class:is-ancestor={role === 'ancestor'}
					class:is-descendant={role === 'descendant'}
					class:is-partner={role === 'partner'}
					class:is-selected={p.id === selectedPersonId}
					aria-label="{p.person.displayName}{years ? `, ${years}` : ''}. Centre the rings on them."
					onclick={() => onSelectPerson?.(p.id)}
					ondblclick={() => onOpenPerson?.(p.id)}
					onkeydown={(event) => onTagKey(event, p.id)}
					{@attach tracked(p.id)}
				>
					{p.person.displayName}
				</button>
			{/each}
		</div>
	{/if}

	{#if didFail}
		<div class="absolute inset-0 z-10 flex items-center justify-center p-6 text-center">
			<p class="max-w-sm text-sm text-stone-700">
				Rings needs WebGL, which this browser has turned off or does not support. Flat shows the
				same people.
			</p>
		</div>
	{:else if layout.people.length === 0}
		<div class="absolute inset-0 z-10 flex items-center justify-center">
			<p class="text-base font-medium text-stone-700">No people in this tree yet.</p>
		</div>
	{/if}

	<div class="legend absolute top-4 left-4 z-20" aria-hidden="true">
		<span><i style="background:{RING_TOKENS.male}"></i>Male</span>
		<span><i style="background:{RING_TOKENS.female}"></i>Female</span>
		<span><i style="background:{RING_TOKENS.unknownSex}"></i>Other or unknown</span>
		<span><i class="halo" style="border-color:{RING_TOKENS.focus}"></i>Focus</span>
		<span><b style="background:{RING_TOKENS.ancestor}"></b>Ancestor line</span>
		<span><b style="background:{RING_TOKENS.descendant}"></b>Descendant line</span>
		<span><b style="background:{RING_TOKENS.partner}"></b>Partnership</span>
	</div>

	<div
		class="pointer-events-none absolute inset-x-3 bottom-4 z-20 flex flex-wrap items-end justify-between gap-2 sm:inset-x-6 sm:bottom-6"
	>
		<div
			class="pointer-events-auto flex flex-wrap items-center gap-2 rounded-xl border border-[var(--tree-panel-border)] bg-[var(--tree-panel)] p-1.5 text-xs shadow-md"
		>
			<div class="flex items-center gap-1" role="group" aria-label="Camera">
				{#each Object.entries(CAMERA_LABELS) as [option, label] (option)}
					<button
						type="button"
						class="view"
						aria-pressed={camera === option}
						onclick={() => (camera = option as RingCamera)}
					>
						{label}
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
		</div>
		<p
			class="hidden rounded-full border border-[var(--tree-panel-border)] bg-[var(--tree-panel)] px-3 py-1 text-xs text-stone-600 shadow-sm sm:block"
		>
			Drag to orbit · scroll to zoom · right-drag to pan · double-click for details
		</p>
	</div>

	<p class="sr-only" aria-live="polite">{announcement}</p>
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
	.view {
		padding: 0.25rem 0.625rem;
		border-radius: 0.5rem;
		border: 1px solid var(--tree-panel-border);
		color: #44403c;
		font-weight: 600;
		cursor: pointer;
	}
	.view[aria-pressed='true'] {
		background: var(--color-emerald-800);
		border-color: var(--color-emerald-800);
		color: var(--color-amber-50);
	}
	.view:focus-visible {
		outline: 2px solid var(--tree-focus-ring);
		outline-offset: 2px;
	}
</style>
