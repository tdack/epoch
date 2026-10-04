<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import {
		LAYOUT_METRICS,
		type Band,
		type ChildEdge,
		type PlacedPerson,
		type PlacedUnion
	} from '#lib/tree-layout/index.js';
	import type { LayerPerson, LayersLayout } from '#lib/tree-layout/layers.js';
	import CollapserMark from './CollapserMark.svelte';
	import type { PartnershipLabel } from '#lib/shared/partnership-labels.js';
	import FoldMark from './FoldMark.svelte';
	import PersonCard from './PersonCard.svelte';
	import PlaneStack, { type ConnectorSpec, type PlaneSpec } from './PlaneStack.svelte';
	import StubMark from './StubMark.svelte';
	import TreeContextMenu from './TreeContextMenu.svelte';
	import TreeEdge from './TreeEdge.svelte';
	import TreeLegend from './TreeLegend.svelte';
	import UnionMarker from './UnionMarker.svelte';
	import ZoomControls from './ZoomControls.svelte';
	import {
		LAYER_VIEWS,
		layerCamera,
		layerOffset,
		layerPoint,
		layersFraming,
		planeScreenBox,
		type LayerView
	} from './plane-stack.js';
	import { foldWideRows, isBoxInView, type FoldMark as FoldMarkSpec } from './plane-scale.js';
	import { CAMERA_TOKENS } from './tree-tokens.js';
	import { childLinks, type PlaneNav } from './plane-keyboard.js';
	import { PlaneInteractions } from './plane-interactions.svelte.js';
	import {
		personMenuItems,
		unionMenuItems,
		type PersonRef,
		type TreeEditActions
	} from './tree-actions.js';
	import { BAND_FADE, treeTokenStyle } from './tree-tokens.js';
	import { TreeViewport } from './tree-viewport.svelte.js';
	import {
		isEndedUnion,
		levelOfDetail,
		truncate,
		unionLabelText,
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
		/** What the context menus can do; an absent action leaves its entry out. */
		actions?: TreeEditActions;
		/** Chronological labels for repeated partnerships between the same people, by union id. */
		partnershipLabels?: Map<string, PartnershipLabel>;
		/** User dragged one person onto another. */
		onDragRelate?: (relate: { source: PersonRef; target: PersonRef }) => void;
		/** On a phone one plane fills the screen and tabs choose it, instead of a tilted stack. */
		isSinglePlane?: boolean;
	}

	let {
		layout,
		fitKey,
		selectedPersonId = null,
		onSelectPerson,
		onOpenPerson,
		onClearSelection,
		onExpandStub,
		onCollapseStub,
		actions = {},
		partnershipLabels,
		onDragRelate,
		isSinglePlane = false
	}: Props = $props();

	const M = LAYOUT_METRICS;
	const ZOOM_STEP = 1.35;
	/** A back row with more cards than this folds the far ones into a "+N" mark. */
	const FOLD_LIMIT_CARDS = 10;
	/** A plane this far off the canvas is still drawn, so a pan does not wait for it to mount. */
	const CULL_MARGIN_PX = 240;
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

	// The flattest camera for a viewer who asked for less motion; the angled one shows the depth.
	let chosenView = $state<LayerView>(
		typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
			? LAYER_VIEWS.FRONT
			: LAYER_VIEWS.ANGLED
	);
	/** A phone is shown straight on: the tilt needs width to read. */
	const layerView = $derived<LayerView>(isSinglePlane ? LAYER_VIEWS.FRONT : chosenView);
	/** Planes the viewer has switched off, so a plane in front can be cleared away to read the one behind. */
	let hiddenPlaneList = $state<Band[]>([]);
	/** The tab the phone shows; falls back to the first plane when that one is not in this layout. */
	let tabPlane = $state<Band>(0);
	const activePlane = $derived<Band>(
		layout.planes.some((p) => p.plane === tabPlane) ? tabPlane : (layout.planes[0]?.plane ?? 0)
	);
	const hiddenPlanes = $derived<ReadonlySet<Band>>(
		isSinglePlane
			? new Set(layout.planes.map((p) => p.plane).filter((plane) => plane !== activePlane))
			: new Set(hiddenPlaneList)
	);
	const isShown = (plane: Band) => !hiddenPlanes.has(plane);

	let containerElement: HTMLDivElement | null = $state(null);
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
	const announcement = $derived(
		layout.focusPersonId
			? `Tree focused on ${peopleById.get(layout.focusPersonId)?.person.displayName ?? 'unknown'}, shown as layers. ${layout.people.length} people shown.`
			: ''
	);

	/** Open rows stay open until the chart is redrawn around someone else. */
	let openRowKeys = $state<string[]>([]);
	$effect(() => {
		void fitKey;
		untrack(() => (openRowKeys = []));
	});
	const fold: ReturnType<typeof foldWideRows> = $derived.by(() => {
		const focus = peopleById.get(layout.focusPersonId ?? '');
		return foldWideRows(
			layout.people
				.filter((p) => isShown(p.plane))
				.map((p) => ({ id: p.id, group: p.plane, generation: p.generation, x: p.x })),
			{
				limit: FOLD_LIMIT_CARDS,
				centreX: focus?.x ?? 0,
				// Whoever holds the focus, the keyboard cursor or the drawer must stay a card.
				protectedIds: new Set(
					[layout.focusPersonId, selectedPersonId, interactions.cursorPersonId].filter(
						(id): id is string => !!id
					)
				),
				openRowKeys: new Set(openRowKeys)
			}
		);
	});
	/** The layout without the folded cards and everything that hung from them. */
	const drawn = $derived.by(() => {
		const gone = fold.hiddenIds;
		const isGone = (id: string) => gone.has(id);
		const hiddenUnionIds = new Set(
			layout.unions.filter((u) => u.union.partnerIds.some(isGone)).map((u) => u.id)
		);
		return {
			people: layout.people.filter((p) => !isGone(p.id)),
			ghosts: layout.ghosts.filter((g) => !isGone(g.personId)),
			unions: layout.unions.filter((u) => !hiddenUnionIds.has(u.id)),
			stubs: layout.stubs.filter((s) => !isGone(s.personId)),
			collapsers: layout.collapsers.filter((c) => !isGone(c.personId)),
			depthLinks: layout.depthLinks.filter((l) => !isGone(l.personId)),
			edges: layout.edges.filter((e) => {
				if (e.kind === 'partner') return !isGone(e.personId) && !hiddenUnionIds.has(e.unionId);
				if (e.kind === 'child')
					return !isGone(e.childId) && !(e.unionId && hiddenUnionIds.has(e.unionId));
				const stub = stubById.get(e.stubId);
				return !!stub && !isGone(stub.personId);
			})
		};
	});

	/** What the arrow keys walk: the planes in view, and the lines that join their people. */
	const nav = $derived<PlaneNav>({
		people: layout.people
			.filter((p) => isShown(p.plane) && !fold.hiddenIds.has(p.id))
			.map((p) => ({ id: p.id, group: p.plane, generation: p.generation, x: p.x })),
		links: childLinks(
			layout.edges.filter((e): e is ChildEdge & { plane: Band } => e.kind === 'child'),
			new Map(layout.unions.map((u) => [u.id, u.union.partnerIds]))
		),
		unionPartners: layout.unions.map((u) => u.union.partnerIds)
	});
	const interactions: PlaneInteractions = new PlaneInteractions({
		container: () => containerElement,
		focusPersonId: () => layout.focusPersonId,
		nav: () => nav,
		personMenu: (id) => {
			const found = peopleById.get(id);
			return found
				? personMenuItems(
						{ id, displayName: found.person.displayName },
						found.person.unionIds.length > 0,
						actions
					)
				: [];
		},
		unionMenu: (id) => unionMenuItems(id, actions),
		ensureVisible: (id) => {
			const at = framing.people.find((p) => p.id === id);
			if (at) viewport.ensureVisible(at.x, at.y);
		},
		personRef: (id) => {
			const found = peopleById.get(id);
			return found ? { id, displayName: found.person.displayName } : null;
		},
		onClearSelection: () => onClearSelection?.(),
		onDragRelate: (relate) => onDragRelate?.(relate)
	});
	const activeId = $derived(interactions.activeId);

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

	/**
	 * Planes nobody can see for this pan and zoom draw no cards. The plane holding the focus, the
	 * keyboard cursor or the open drawer is always drawn, so focus never lands on nothing.
	 */
	const culledPlaneKeys = $derived.by(() => {
		const { rotateXDeg, rotateYDeg } = CAMERA_TOKENS[layerCamera(layerView)];
		const keep = new Set(
			[layout.focusPersonId, selectedPersonId, activeId]
				.map((id) => (id ? peopleById.get(id)?.plane : undefined))
				.filter((plane) => plane !== undefined)
				.map(String)
		);
		return new Set(
			planes
				.filter(
					(spec) =>
						!keep.has(spec.key) &&
						!isBoxInView(
							planeScreenBox(
								spec.bounds,
								{ x: spec.offset?.x ?? 0, y: spec.offset?.y ?? 0, z: spec.z },
								rotateXDeg,
								rotateYDeg
							),
							transform,
							viewport.size,
							CULL_MARGIN_PX
						)
				)
				.map((spec) => spec.key)
		);
	});
	/** The mark's row, named as its cards are. */
	const rowNameOf = (mark: FoldMarkSpec) => BAND_NAMES[mark.group as Band];

	/** Joins a placeholder to the real card of the same person on another plane. */
	const connectors = $derived<ConnectorSpec[]>(
		drawn.depthLinks
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
</script>

<!-- Arrow-key handling is delegated from the focusable cards inside; the container itself is not a tab stop. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	bind:this={containerElement}
	class="tree-canvas layers-canvas relative h-[max(28rem,calc(100vh-22rem))] w-full overflow-hidden rounded-2xl border border-stone-300/80 shadow-inner"
	style="{treeTokenStyle()}; background: var(--tree-bg);"
	role="application"
	aria-label="Family tree, layers view"
	tabindex="-1"
	onkeydown={interactions.onKeydown}
	onpointerup={interactions.onPointerUp}
	onpointercancel={interactions.onPointerCancel}
>
	<div
		class="pointer-events-none absolute inset-0 opacity-40"
		style="background-image: radial-gradient(circle, var(--tree-dot) 1px, transparent 1px); background-size: 24px 24px;"
	></div>

	<div
		bind:this={surfaceElement}
		class="scene surface relative z-10 h-full w-full cursor-grab select-none active:cursor-grabbing"
	>
		<PlaneStack
			{planes}
			{connectors}
			camera={layerCamera(layerView)}
			{transform}
			settleKey={fitKey}
		>
			{#snippet plane(spec)}
				{@const band = Number(spec.key) as Band}
				{@const level = levelOf(band)}
				<g class="plane-content" data-plane={band} style:opacity={BAND_FADE[band]}>
					{#if !culledPlaneKeys.has(spec.key)}
						{#each drawn.edges.filter((e) => e.plane === band) as edge (edge.id)}
							{@const stub = edge.kind === 'stub' ? stubById.get(edge.stubId) : undefined}
							{@const union = edge.kind === 'partner' ? unionById.get(edge.unionId) : undefined}
							<TreeEdge
								{edge}
								{stub}
								isFromUnion={stub ? stub.unionId !== null : false}
								isUnionEnded={union ? isEndedUnion(union.union.status) : false}
							/>
						{/each}

						{#each drawn.unions.filter((u) => u.plane === band) as union (union.id)}
							<UnionMarker
								union={placedUnion(union)}
								{level}
								isEnded={isEndedUnion(union.union.status)}
								isNonAdjacent={false}
								label={unionLabelText(union.union)}
								ordinalTitle={partnershipLabels?.get(union.id)?.title}
								zoom={transform.k}
								onContextMenu={(event, u) => interactions.openUnionMenu(event, u.id)}
							/>
						{/each}

						{#each drawn.ghosts.filter((g) => g.plane === band) as ghost (ghost.id)}
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

						{#each drawn.people.filter((p) => p.plane === band) as person (person.id)}
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
								onContextMenu={(event, node) => interactions.openPersonMenu(event, node.id)}
								onPointerDown={interactions.onCardPointerDown}
							/>
						{/each}

						<!-- Hit targets follow the cards, so Tab reaches a person's partnerships right after the person. -->
						{#each drawn.unions.filter((u) => u.plane === band) as union (union.id)}
							<UnionMarker
								union={placedUnion(union)}
								{level}
								part="target"
								isEnded={isEndedUnion(union.union.status)}
								isNonAdjacent={false}
								isTabbable={!!activeId && union.union.partnerIds.includes(activeId)}
								partnerNames={union.union.partnerIds
									.map((id) => peopleById.get(id)?.person.displayName ?? id)
									.join(' and ')}
								label={unionLabelText(union.union)}
								ordinalTitle={partnershipLabels?.get(union.id)?.title}
								zoom={transform.k}
								onOpen={(u) => actions.onEditUnion?.(u.id)}
								onContextMenu={(event, u) => interactions.openUnionMenu(event, u.id)}
							/>
						{/each}

						{#each drawn.stubs.filter((s) => s.plane === band) as stub (stub.id)}
							<StubMark
								{stub}
								x={stub.x}
								y={stub.generation * M.rowHeight}
								onExpand={(id) => onExpandStub?.(id)}
							/>
						{/each}

						{#each drawn.collapsers.filter((c) => c.plane === band) as collapser (collapser.stubId)}
							<CollapserMark
								stubId={collapser.stubId}
								x={collapser.x}
								y={collapser.y}
								onCollapse={(id) => onCollapseStub?.(id)}
							/>
						{/each}

						{#each fold.marks.filter((m) => m.group === band) as mark (mark.id)}
							<FoldMark
								{mark}
								x={mark.x}
								y={mark.generation * M.rowHeight}
								rowName={rowNameOf(mark)}
								onOpen={() => (openRowKeys = [...openRowKeys, mark.rowKey])}
							/>
						{/each}
					{/if}
				</g>
			{/snippet}
		</PlaneStack>
	</div>

	{#if layout.people.length === 0}
		<div class="absolute inset-0 z-10 flex items-center justify-center">
			<p class="text-base font-medium text-stone-700">No people in this tree yet.</p>
		</div>
	{/if}

	<div class="absolute top-4 left-4 z-20 max-h-[calc(100%-2rem)]">
		<TreeLegend />
	</div>

	<div
		class="absolute bottom-6 left-6 z-20 flex flex-wrap items-center gap-3 rounded-xl border border-stone-300 p-2 text-xs shadow-md"
		style="background: var(--tree-panel);"
	>
		{#if isSinglePlane}
			<div class="flex items-center gap-1" role="group" aria-label="Plane">
				{#each layout.planes as p (p.plane)}
					<button
						type="button"
						class="view"
						aria-pressed={activePlane === p.plane}
						onclick={() => (tabPlane = p.plane)}
					>
						{p.plane === 0 ? 'Union' : p.plane === 1 ? 'Families' : 'Cousins'}
					</button>
				{/each}
			</div>
		{:else}
			<div class="flex items-center gap-1" role="group" aria-label="Camera">
				{#each Object.values(LAYER_VIEWS) as option (option)}
					<button
						type="button"
						class="view"
						aria-pressed={chosenView === option}
						onclick={() => (chosenView = option)}
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
		{/if}
	</div>

	<ZoomControls
		scale={transform.k}
		onZoomIn={() => viewport.zoomBy(ZOOM_STEP)}
		onZoomOut={() => viewport.zoomBy(1 / ZOOM_STEP)}
		onFit={() => viewport.fit(framing)}
	/>

	{#if interactions.menu}
		<TreeContextMenu
			items={interactions.menu.items}
			x={interactions.menu.x}
			y={interactions.menu.y}
			onClose={interactions.closeMenu}
		/>
	{/if}

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
