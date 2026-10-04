<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import {
		LAYOUT_METRICS,
		type Band,
		type PlacedPerson,
		type PlacedUnion
	} from '#lib/tree-layout/index.js';
	import type { LayerPerson, LayersLayout } from '#lib/tree-layout/layers.js';
	import CollapserMark from './CollapserMark.svelte';
	import PersonCard from './PersonCard.svelte';
	import PlaneStack, { type ConnectorSpec, type PlaneSpec } from './PlaneStack.svelte';
	import StubMark from './StubMark.svelte';
	import TreeEdge from './TreeEdge.svelte';
	import TreeLegend from './TreeLegend.svelte';
	import UnionMarker from './UnionMarker.svelte';
	import ZoomControls from './ZoomControls.svelte';
	import {
		BAND_OPACITY,
		LAYER_VIEWS,
		layerCamera,
		layerOffset,
		layerPoint,
		layersFraming,
		type LayerView
	} from './plane-stack.js';
	import { treeTokenStyle } from './tree-tokens.js';
	import { TreeViewport } from './tree-viewport.svelte.js';
	import {
		isEndedUnion,
		levelOfDetail,
		truncate,
		yearsLine,
		type LevelOfDetail
	} from './tree-view.js';

	interface Props {
		/** Planes, rows and the lines between them from `layoutLayers`. */
		layout: LayersLayout;
		/** Changes when the view should be re-framed; see `TreeCanvas`. */
		fitKey: string;
		/** Person whose details are open in the drawer, if any. */
		selectedPersonId?: string | null;
		/** A card was clicked or activated with Enter/Space: refocus the chart on it. */
		onSelectPerson?: (id: string) => void;
		/** Double-click, long-press or Shift+Enter on a person: open their details. */
		onOpenPerson?: (id: string) => void;
		/** Escape: drop the selection. */
		onClearSelection?: () => void;
		/** A "+N" stub was activated; the caller adds its id to the expanded set. */
		onExpandStub?: (stubId: string) => void;
		/** A collapse control was activated; the caller removes the id. */
		onCollapseStub?: (stubId: string) => void;
	}

	let {
		layout,
		fitKey,
		selectedPersonId = null,
		onSelectPerson,
		onOpenPerson,
		onClearSelection,
		onExpandStub,
		onCollapseStub
	}: Props = $props();

	const M = LAYOUT_METRICS;
	const ZOOM_STEP = 1.35;
	const PLANE_PADDING_PX = 40;
	const PLANE_NAMES = [
		'The union and its descendants',
		'The families it came from',
		'The cousin line'
	] as const;
	const BAND_NAMES = ['direct line', 'sibling line', 'cousin line'] as const;
	const VIEW_LABELS: Record<LayerView, string> = {
		front: 'Front',
		angled: 'Angled',
		exploded: 'Exploded'
	};
	/** Distance below a card row at which a hanging union node sits; matches the flat layout. */
	const HANG_OFFSET_PX = M.cardHeight / 2 + M.unionRadius + 4;

	let layerView = $state<LayerView>(LAYER_VIEWS.ANGLED);
	/** Planes the viewer has switched off, so a plane in front can be cleared away to read the one behind. */
	let hiddenPlaneList = $state<Band[]>([]);
	const hiddenPlanes = $derived(new Set(hiddenPlaneList));
	const isShown = (plane: Band) => !hiddenPlanes.has(plane);

	let surfaceElement: HTMLDivElement | null = $state(null);
	const viewport = new TreeViewport();
	const transform = $derived(viewport.transform);
	/** The same pan and zoom maths as the flat canvas, run on where the planes land on screen. */
	const framing = $derived(layersFraming(layout, layerView, hiddenPlanes));
	const zoomLevel = $derived(levelOfDetail(transform.k));

	const peopleById = $derived(new Map(layout.people.map((p) => [p.id, p])));
	const unionById = $derived(new Map(layout.unions.map((u) => [u.id, u])));
	const stubById = $derived(new Map(layout.stubs.map((s) => [s.id, s])));
	const collapsedIds = $derived(new Set(layout.collapsedPersonIds));
	const activeId = $derived(layout.focusPersonId);
	const announcement = $derived(
		layout.focusPersonId
			? `Tree focused on ${peopleById.get(layout.focusPersonId)?.person.displayName ?? 'unknown'}, shown as layers. ${layout.people.length} people shown.`
			: ''
	);

	function levelOf(plane: Band): LevelOfDetail {
		return zoomLevel === 'full' && plane === 2 ? 'compact' : zoomLevel;
	}

	const planes = $derived<PlaneSpec[]>(
		layout.planes
			.filter((p) => isShown(p.plane))
			.map((p) => {
				const offset = layerOffset(p.plane, layerView);
				return {
					key: String(p.plane),
					z: offset.z,
					offset: { x: offset.x, y: offset.y },
					label: PLANE_NAMES[p.plane],
					bounds: {
						minX: layout.bounds.minX - PLANE_PADDING_PX,
						maxX: layout.bounds.maxX + PLANE_PADDING_PX,
						minY: Math.min(...p.generations) * M.rowHeight - M.cardHeight / 2 - 36,
						// Room under the lowest row for a union hanging below it.
						maxY: Math.max(...p.generations) * M.rowHeight + M.cardHeight / 2 + 56
					}
				};
			})
	);

	/** Joins a placeholder to the real card of the same person on another plane. */
	const connectors = $derived<ConnectorSpec[]>(
		layout.depthLinks
			.filter((link) => isShown(link.from.plane) && isShown(link.to.plane))
			.map((link) => ({
				id: link.id,
				from: layerPoint(link.from.plane, link.from.generation, link.from.x, layerView),
				to: layerPoint(link.to.plane, link.to.generation, link.to.x, layerView),
				colorVar: '--rel-unknown',
				lineStyle: 'dotted' as const
			}))
	);

	const unionY = (u: { generation: number; isHanging: boolean }) =>
		u.generation * M.rowHeight + (u.isHanging ? HANG_OFFSET_PX : 0);

	function placedPerson(p: LayerPerson): PlacedPerson {
		return {
			id: p.id,
			x: p.x,
			y: p.generation * M.rowHeight,
			generation: p.generation,
			role: p.role,
			person: p.person
		};
	}

	function placedUnion(u: LayersLayout['unions'][number]): PlacedUnion {
		return {
			id: u.id,
			x: u.x,
			y: unionY(u),
			generation: u.generation,
			isHanging: u.isHanging,
			union: u.union
		};
	}

	function relationOf(p: LayerPerson): string {
		return p.role === 'focus' ? 'focus person' : BAND_NAMES[p.band];
	}

	function toggleVisible(plane: Band) {
		hiddenPlaneList = isShown(plane)
			? [...hiddenPlaneList, plane]
			: hiddenPlaneList.filter((p) => p !== plane);
	}

	onMount(() => {
		if (!surfaceElement) return;
		return viewport.attach(surfaceElement, () => viewport.fit(framing, false));
	});

	// Re-frame when the key changes; see `TreeViewport.reframe`.
	$effect(() => {
		const key = fitKey;
		const current = framing;
		untrack(() => viewport.reframe(key, current, surfaceElement));
	});

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') onClearSelection?.();
	}

	const noop = () => {};
	// There is no menu or drag-to-relate in this preview; the browser's own menu should not open on a card.
	function ignoreContextMenu(event: MouseEvent) {
		event.preventDefault();
	}
</script>

<!-- Arrow-key handling is delegated from the focusable cards inside; the container itself is not a tab stop. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="tree-canvas layers-canvas relative h-[max(28rem,calc(100vh-22rem))] w-full overflow-hidden rounded-2xl border border-stone-300/80 shadow-inner"
	style="{treeTokenStyle()}; background: var(--tree-bg);"
	role="application"
	aria-label="Family tree, layers view"
	tabindex="-1"
	onkeydown={onKeydown}
>
	<div
		class="pointer-events-none absolute inset-0 opacity-40"
		style="background-image: radial-gradient(circle, var(--tree-dot) 1px, transparent 1px); background-size: 24px 24px;"
	></div>

	<div
		bind:this={surfaceElement}
		class="scene surface relative z-10 h-full w-full cursor-grab select-none active:cursor-grabbing"
	>
		<PlaneStack {planes} {connectors} camera={layerCamera(layerView)} {transform}>
			{#snippet plane(spec)}
				{@const band = Number(spec.key) as Band}
				{@const level = levelOf(band)}
				<g class="plane-content" data-plane={band} style:opacity={BAND_OPACITY[band]}>
					{#each layout.edges.filter((e) => e.plane === band) as edge (edge.id)}
						{@const stub = edge.kind === 'stub' ? stubById.get(edge.stubId) : undefined}
						{@const union = edge.kind === 'partner' ? unionById.get(edge.unionId) : undefined}
						<TreeEdge
							{edge}
							{stub}
							isFromUnion={stub ? stub.unionId !== null : false}
							isUnionEnded={union ? isEndedUnion(union.union.status) : false}
						/>
					{/each}

					{#each layout.unions.filter((u) => u.plane === band) as union (union.id)}
						<UnionMarker
							union={placedUnion(union)}
							{level}
							isEnded={isEndedUnion(union.union.status)}
							isNonAdjacent={false}
							zoom={transform.k}
							onContextMenu={ignoreContextMenu}
						/>
					{/each}

					{#each layout.ghosts.filter((g) => g.plane === band) as ghost (ghost.id)}
						{@const real = peopleById.get(ghost.personId)}
						<g
							class="ghost"
							data-ghost-id={ghost.id}
							transform="translate({ghost.x}, {ghost.generation * M.rowHeight})"
							role="button"
							tabindex="-1"
							aria-label="{ghost.person.displayName}, also shown on {real
								? PLANE_NAMES[real.plane].toLowerCase()
								: 'another plane'}"
							onclick={() => onSelectPerson?.(ghost.personId)}
							onkeydown={(event) => {
								if (event.key === 'Enter' || event.key === ' ') {
									event.preventDefault();
									onSelectPerson?.(ghost.personId);
								}
							}}
						>
							<rect
								x={-M.cardWidth / 2}
								y={-M.cardHeight / 2}
								width={M.cardWidth}
								height={M.cardHeight}
								rx="10"
							/>
							<text text-anchor="middle" y="-2" class="name"
								>{truncate(ghost.person.displayName, 26)}</text
							>
							<text text-anchor="middle" y="16" class="years">{yearsLine(ghost.person)}</text>
						</g>
					{/each}

					{#each layout.people.filter((p) => p.plane === band) as person (person.id)}
						<PersonCard
							node={placedPerson(person)}
							{level}
							zoom={level === 'block' ? transform.k : 1}
							isFocus={person.id === layout.focusPersonId}
							isSelected={person.id === selectedPersonId}
							isActive={person.id === activeId}
							hasMultiplePaths={collapsedIds.has(person.id)}
							relation={relationOf(person)}
							onSelect={(id) => onSelectPerson?.(id)}
							onOpen={(id) => onOpenPerson?.(id)}
							onContextMenu={ignoreContextMenu}
							onPointerDown={noop}
						/>
					{/each}

					{#each layout.stubs.filter((s) => s.plane === band) as stub (stub.id)}
						<StubMark
							{stub}
							x={stub.x}
							y={stub.generation * M.rowHeight}
							onExpand={(id) => onExpandStub?.(id)}
						/>
					{/each}

					{#each layout.collapsers.filter((c) => c.plane === band) as collapser (collapser.stubId)}
						<CollapserMark
							stubId={collapser.stubId}
							x={collapser.x}
							y={collapser.y}
							onCollapse={(id) => onCollapseStub?.(id)}
						/>
					{/each}
				</g>
			{/snippet}
		</PlaneStack>
	</div>

	{#if layout.people.length === 0}
		<div class="absolute inset-0 z-10 flex items-center justify-center">
			<p class="text-base font-medium text-stone-700">No people in this tree yet.</p>
		</div>
	{/if}

	<p
		class="absolute top-4 right-4 z-20 rounded-full border border-stone-300 px-2.5 py-0.5 text-xs font-semibold text-stone-600"
		style="background: var(--tree-panel);"
	>
		Preview
	</p>

	<div class="absolute top-4 left-4 z-20 max-h-[calc(100%-2rem)]">
		<TreeLegend />
	</div>

	<div
		class="absolute bottom-6 left-6 z-20 flex flex-wrap items-center gap-3 rounded-xl border border-stone-300 p-2 text-xs shadow-md"
		style="background: var(--tree-panel);"
	>
		<div class="flex items-center gap-1" role="group" aria-label="Camera">
			{#each Object.values(LAYER_VIEWS) as option (option)}
				<button
					type="button"
					class="view"
					aria-pressed={layerView === option}
					onclick={() => (layerView = option)}
				>
					{VIEW_LABELS[option]}
				</button>
			{/each}
		</div>
		<div class="flex items-center gap-2" role="group" aria-label="Planes shown">
			{#each layout.planes as p (p.plane)}
				<label class="flex cursor-pointer items-center gap-1 text-stone-700">
					<input
						type="checkbox"
						checked={isShown(p.plane)}
						onchange={() => toggleVisible(p.plane)}
						aria-label="Show {PLANE_NAMES[p.plane].toLowerCase()}"
					/>
					{p.plane === 0 ? 'Union' : p.plane === 1 ? 'Families' : 'Cousins'}
				</label>
			{/each}
		</div>
	</div>

	<ZoomControls
		scale={transform.k}
		onZoomIn={() => viewport.zoomBy(ZOOM_STEP)}
		onZoomOut={() => viewport.zoomBy(1 / ZOOM_STEP)}
		onFit={() => viewport.fit(framing)}
	/>

	<p class="sr-only" aria-live="polite">{announcement}</p>
</div>

<style>
	.view {
		padding: 0.25rem 0.625rem;
		border-radius: 0.5rem;
		border: 1px solid var(--tree-panel-border);
		color: #44403c;
		font-weight: 600;
		cursor: pointer;
	}
	.view[aria-pressed='true'] {
		background: var(--tree-ink);
		border-color: var(--tree-ink);
		color: var(--tree-panel);
	}
	.view:focus-visible {
		outline: 2px solid var(--tree-focus-ring);
		outline-offset: 2px;
	}
	.ghost {
		cursor: pointer;
		outline: none;
	}
	.ghost rect {
		fill: var(--tree-panel);
		fill-opacity: 0.55;
		stroke: var(--tree-ink-muted);
		stroke-width: 1.5;
		stroke-dasharray: 6 4;
	}
	.ghost text {
		fill: var(--tree-ink-muted);
		font-size: 13px;
	}
	.ghost .name {
		font-weight: 600;
	}
	.ghost:hover rect,
	.ghost:focus-visible rect {
		stroke: var(--tree-focus-ring);
		stroke-width: 3;
	}
</style>
