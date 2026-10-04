<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { LAYOUT_METRICS, type PlacedPerson, type PlacedUnion } from '#lib/tree-layout/index.js';
	import type { FloorPerson, FloorsLayout } from '#lib/tree-layout/floors.js';
	import CollapserMark from './CollapserMark.svelte';
	import PersonCard from './PersonCard.svelte';
	import PlaneStack, { type ConnectorSpec, type PlaneSpec } from './PlaneStack.svelte';
	import StubMark from './StubMark.svelte';
	import TreeContextMenu from './TreeContextMenu.svelte';
	import TreeEdge from './TreeEdge.svelte';
	import TreeLegend from './TreeLegend.svelte';
	import UnionMarker from './UnionMarker.svelte';
	import ZoomControls from './ZoomControls.svelte';
	import { BAND_OPACITY, bandRowY, floorPoint, framingLayout } from './plane-stack.js';
	import type { PartnershipLabel } from '#lib/shared/partnership-labels.js';
	import { childLinks, type PlaneNav } from './plane-keyboard.js';
	import { PlaneInteractions } from './plane-interactions.svelte.js';
	import {
		personMenuItems,
		unionMenuItems,
		type PersonRef,
		type TreeEditActions
	} from './tree-actions.js';
	import { treeTokenStyle } from './tree-tokens.js';
	import { TreeViewport } from './tree-viewport.svelte.js';
	import {
		childEdgeStyle,
		isEndedUnion,
		levelOfDetail,
		unionLabelText,
		type LevelOfDetail
	} from './tree-view.js';

	interface Props {
		/** Floors, rows and the lines between them from `layoutFloors`. */
		layout: FloorsLayout;
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
		onDragRelate
	}: Props = $props();

	const M = LAYOUT_METRICS;
	const ZOOM_STEP = 1.35;
	const PLANE_PADDING_PX = 40;
	/** Floors this many generations from the focus drop a level of detail, so the far ones stay light. */
	const FAR_FLOOR_GENERATIONS = 2;
	const BAND_NAMES = ['direct line', 'sibling line', 'cousin line'] as const;
	const BAND_LABELS = ['Direct line', 'Sibling line', 'Cousin line'] as const;

	let containerElement: HTMLDivElement | null = $state(null);
	let surfaceElement: HTMLDivElement | null = $state(null);
	const viewport = new TreeViewport();
	const transform = $derived(viewport.transform);
	/** The same pan and zoom maths as the flat canvas, run on where the floors land on screen. */
	const framing = $derived(framingLayout(layout));
	const zoomLevel = $derived(levelOfDetail(transform.k));

	const peopleById = $derived(new Map(layout.people.map((p) => [p.id, p])));
	const unionById = $derived(new Map(layout.unions.map((u) => [u.id, u])));
	const stubById = $derived(new Map(layout.stubs.map((s) => [s.id, s])));
	const collapsedIds = $derived(new Set(layout.collapsedPersonIds));
	const announcement = $derived(
		layout.focusPersonId
			? `Tree focused on ${peopleById.get(layout.focusPersonId)?.person.displayName ?? 'unknown'}, shown as floors. ${layout.people.length} people shown.`
			: ''
	);

	/** What the arrow keys walk: every person by floor and band, and the lines between floors. */
	const nav = $derived<PlaneNav>({
		people: layout.people.map((p) => ({
			id: p.id,
			group: p.band,
			generation: p.generation,
			x: p.x
		})),
		links: childLinks(layout.drops, new Map(layout.unions.map((u) => [u.id, u.union.partnerIds]))),
		unionPartners: layout.unions.map((u) => u.union.partnerIds)
	});
	const interactions = new PlaneInteractions({
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

	function levelOf(generation: number): LevelOfDetail {
		return zoomLevel === 'full' && Math.abs(generation) >= FAR_FLOOR_GENERATIONS
			? 'compact'
			: zoomLevel;
	}

	function generationLabel(generation: number): string {
		if (generation === 0) return 'Focus generation';
		const steps = Math.abs(generation);
		return `${steps} ${steps === 1 ? 'generation' : 'generations'} ${generation < 0 ? 'up' : 'down'}`;
	}

	const planes = $derived<PlaneSpec[]>(
		layout.floors.map((floor) => {
			const bands = floor.bands;
			return {
				key: String(floor.generation),
				z: floorPoint(floor.generation, 0, 0).z,
				label: generationLabel(floor.generation),
				bounds: {
					minX: layout.bounds.minX - PLANE_PADDING_PX,
					maxX: layout.bounds.maxX + PLANE_PADDING_PX,
					minY: bandRowY(Math.max(...bands) as 0 | 1 | 2) - M.cardHeight / 2 - 36,
					// Room under the lowest row for a union hanging below it.
					maxY: bandRowY(Math.min(...bands) as 0 | 1 | 2) + M.cardHeight / 2 + 56
				}
			};
		})
	);

	/** Distance below a card row at which a hanging union node sits; matches the flat layout. */
	const HANG_OFFSET_PX = M.cardHeight / 2 + M.unionRadius + 4;

	function unionY(union: { band: 0 | 1 | 2; isHanging: boolean }): number {
		return bandRowY(union.band) + (union.isHanging ? HANG_OFFSET_PX : 0);
	}

	/** How far below its row a child line leaves: from the union node, else from the parent's card. */
	function exitDy(unionId: string | null): number {
		const union = unionId ? unionById.get(unionId) : undefined;
		return union
			? union.isHanging
				? HANG_OFFSET_PX + M.unionRadius
				: M.unionRadius
			: M.cardHeight / 2;
	}

	function placedPerson(p: FloorPerson): PlacedPerson {
		return {
			id: p.id,
			x: p.x,
			y: bandRowY(p.band),
			generation: p.generation,
			role: p.role,
			person: p.person
		};
	}

	function placedUnion(u: FloorsLayout['unions'][number]): PlacedUnion {
		return {
			id: u.id,
			x: u.x,
			y: unionY(u),
			generation: u.generation,
			isHanging: u.isHanging,
			union: u.union
		};
	}

	function relationOf(p: FloorPerson): string {
		return p.role === 'focus' ? 'focus person' : BAND_NAMES[p.band];
	}

	function lineStyleOf(dash: string | null): ConnectorSpec['lineStyle'] {
		if (!dash) return 'solid';
		return dash.startsWith('1 ') ? 'dotted' : 'dashed';
	}

	/** Lines that leave one floor and land on another: parent to child, and a "+N" stub to its owner. */
	const connectors = $derived.by<ConnectorSpec[]>(() => {
		const found: ConnectorSpec[] = [];
		for (const drop of layout.drops) {
			const style = childEdgeStyle(drop.types);
			found.push({
				id: drop.id,
				from: floorPoint(
					drop.leaves.generation,
					drop.leaves.band,
					drop.leaves.x,
					exitDy(drop.unionId)
				),
				to: floorPoint(drop.lands.generation, drop.lands.band, drop.lands.x, -M.cardHeight / 2),
				colorVar: style.colorVar,
				lineStyle: drop.isSecondaryPath ? 'dashed' : lineStyleOf(style.dash),
				opacity: drop.isSecondaryPath ? 0.6 : 1
			});
		}
		for (const link of layout.stubLinks) {
			const stub = stubById.get(link.stubId);
			if (!stub) continue;
			const isAncestors = stub.kind === 'ancestors';
			const ownerDy = isAncestors ? -M.cardHeight / 2 : exitDy(stub.unionId);
			const owner = floorPoint(link.owner.generation, link.owner.band, link.owner.x, ownerDy);
			const end = floorPoint(
				link.stub.generation,
				link.stub.band,
				link.stub.x,
				isAncestors ? M.stubHeight / 2 : -M.stubHeight / 2
			);
			found.push({
				id: link.id,
				from: isAncestors ? end : owner,
				to: isAncestors ? owner : end,
				colorVar: '--rel-unknown',
				lineStyle: 'dotted'
			});
		}
		return found;
	});

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

	/** Where a collapse control sits: over its card for ancestors, under its union or card for children. */
	function collapserAt(collapser: FloorsLayout['collapsers'][number]) {
		const union = collapser.unionId ? unionById.get(collapser.unionId) : undefined;
		const y =
			collapser.kind === 'ancestors'
				? bandRowY(collapser.band) - M.cardHeight / 2
				: union
					? unionY(union) + M.unionRadius + 12
					: bandRowY(collapser.band) + M.cardHeight / 2;
		return { x: collapser.x, y };
	}
</script>

<!-- Arrow-key handling is delegated from the focusable cards inside; the container itself is not a tab stop. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	bind:this={containerElement}
	class="tree-canvas floors-canvas relative h-[max(28rem,calc(100vh-22rem))] w-full overflow-hidden rounded-2xl border border-stone-300/80 shadow-inner"
	style="{treeTokenStyle()}; background: var(--tree-bg);"
	role="application"
	aria-label="Family tree, floors view"
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
		<PlaneStack {planes} {connectors} camera="floors" {transform} settleKey={fitKey}>
			{#snippet plane(spec)}
				{@const generation = Number(spec.key)}
				{@const level = levelOf(generation)}
				{#each [0, 1, 2] as const as band (band)}
					<g
						class="band"
						data-band={band}
						role="group"
						aria-label={BAND_LABELS[band]}
						style:opacity={BAND_OPACITY[band]}
					>
						{#each layout.floorEdges.filter((e) => e.generation === generation && e.band === band) as edge (edge.id)}
							{@const union = unionById.get(edge.unionId)}
							{#if union}
								<TreeEdge
									edge={{
										id: edge.id,
										kind: 'partner',
										unionId: edge.unionId,
										personId: edge.personId,
										source: { x: edge.fromX, y: bandRowY(edge.band) },
										target: { x: edge.toX, y: unionY(union) }
									}}
									isUnionEnded={isEndedUnion(union.union.status)}
								/>
							{/if}
						{/each}

						{#each layout.unions.filter((u) => u.generation === generation && u.band === band) as union (union.id)}
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

						{#each layout.people.filter((p) => p.generation === generation && p.band === band) as person (person.id)}
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
						{#each layout.unions.filter((u) => u.generation === generation && u.band === band) as union (union.id)}
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

						{#each layout.stubs.filter((s) => s.generation === generation && s.band === band) as stub (stub.id)}
							<StubMark
								{stub}
								x={stub.x}
								y={bandRowY(stub.band)}
								onExpand={(id) => onExpandStub?.(id)}
							/>
						{/each}

						{#each layout.collapsers.filter((c) => c.generation === generation && c.band === band) as collapser (collapser.stubId)}
							{@const at = collapserAt(collapser)}
							<CollapserMark
								stubId={collapser.stubId}
								x={at.x}
								y={at.y}
								onCollapse={(id) => onCollapseStub?.(id)}
							/>
						{/each}
					</g>
				{/each}
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
