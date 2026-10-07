<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { Maximize2, ZoomIn, ZoomOut } from '@lucide/svelte';
	import {
		LAYOUT_METRICS,
		type ChildAssertion,
		type ChildEdge,
		type LayoutEdge,
		type PartnerEdge,
		type PlacedPerson,
		type PlacedUnion,
		type TreeLayout
	} from '#lib/tree-layout/index.js';
	import type { ParentChildType } from '#lib/shared/relationship-model.js';
	import OffscreenMarkers from './OffscreenMarkers.svelte';
	import ParentLinkPopover from './ParentLinkPopover.svelte';
	import PersonCard from './PersonCard.svelte';
	import TreeContextMenu from './TreeContextMenu.svelte';
	import TreeEdge from './TreeEdge.svelte';
	import TreeLegend from './TreeLegend.svelte';
	import UnionMarker from './UnionMarker.svelte';
	import { treeTokenStyle } from './tree-tokens.js';
	import type { PartnershipLabel } from '#lib/shared/partnership-labels.js';
	import { activateOnKey } from './activate-on-key.js';
	import { keyIntentOf } from './tree-keyboard.js';
	import {
		personMenuItems,
		unionMenuItems,
		type PersonRef,
		type TreeEditActions
	} from './tree-actions.js';
	import { TreeViewport } from './tree-viewport.svelte.js';
	import { FIT_ACTIONS, offscreenMarkers, type OffscreenMarker } from './view-geometry.js';
	import {
		isEndedUnion,
		levelOfDetail,
		neighbourOf,
		relationLabel,
		unionLabelText,
		type MenuItem
	} from './tree-view.js';

	interface Props {
		/** Positioned people, unions, stubs and edges from `layoutFocusView`. */
		layout: TreeLayout;
		/**
		 * Changes when the view should be re-framed (a new focus, edited data, changed options) and
		 * deliberately not when a stub is expanded, so opening a branch does not move the view.
		 */
		fitKey: string;
		/** Person whose details are open in the drawer, if any. */
		selectedPersonId?: string | null;
		/** A card was clicked or activated with Enter/Space. */
		onSelectPerson?: (id: string) => void;
		/** Double-click, long-press or Shift+Enter on a person: open their details. */
		onOpenPerson?: (id: string) => void;
		/** Escape with nothing else to close: drop the selection. */
		onClearSelection?: () => void;
		/** "Edit person" from a card's context menu. */
		onEditPerson?: (id: string) => void;
		/** "Delete person" from a card's context menu. */
		onDeletePerson?: (id: string) => void;
		/** "Add relationship" from a card's context menu. */
		onAddRelationship?: (anchor: PersonRef) => void;
		/** Remove a partner from a union. */
		onRemoveLink?: (edge: PartnerEdge) => void;
		/** "Record death…" from a card's context menu. */
		onRecordDeath?: (id: string) => void;
		/** "End partnership…" from a card's context menu; the caller asks which one if there are several. */
		onEndPartnership?: (id: string) => void;
		/** A union node was activated (click, Enter) or "Edit partnership…" chosen. */
		onEditUnion?: (unionId: string) => void;
		/** "End partnership…" from a union node's context menu. */
		onEndUnion?: (unionId: string) => void;
		/** Remove one parent's link from a merged (union, child) edge. */
		onRemoveAssertion?: (edge: ChildEdge, assertion: ChildAssertion) => void;
		/** Change one parent's link to another type. */
		onChangeLinkType?: (
			edge: ChildEdge,
			assertion: ChildAssertion,
			toType: ParentChildType
		) => void;
		onRemoveUnion?: (unionId: string) => void;
		/** "Merge duplicate partnerships…", offered only for a partnership that has a twin. */
		onMergeUnion?: (unionId: string) => void;
		/** Unions that have a twin between the same people, and so can be merged. */
		mergeableUnionIds?: Set<string>;
		/** Chronological labels for repeated partnerships between the same people, by union id. */
		partnershipLabels?: Map<string, PartnershipLabel>;
		/** User dragged one person onto another. */
		onDragRelate?: (relate: { source: PersonRef; target: PersonRef }) => void;
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
		onEditPerson,
		onDeletePerson,
		onAddRelationship,
		onRemoveLink,
		onRecordDeath,
		onEndPartnership,
		onEditUnion,
		onEndUnion,
		onRemoveAssertion,
		onChangeLinkType,
		onRemoveUnion,
		onMergeUnion,
		mergeableUnionIds,
		partnershipLabels,
		onDragRelate,
		onExpandStub,
		onCollapseStub
	}: Props = $props();

	const ZOOM_STEP = 1.35;

	let containerElement: HTMLDivElement | null = $state(null);
	let svgElement: SVGSVGElement | null = $state(null);
	const viewport = new TreeViewport();
	const transform = $derived(viewport.transform);
	const size = $derived(viewport.size);
	/** Names what Fit will do next, since on a phone it alternates between two framings. */
	const fitLabel = $derived(
		!viewport.isWholeUnreadable(layout)
			? 'Fit to view'
			: viewport.nextFitAction(layout) === FIT_ACTIONS.FRAME
				? 'Zoom to a readable view'
				: 'Show the whole tree'
	);

	let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);
	let selectedEdgeId = $state<string | null>(null);
	let popover = $state<{ edgeId: string; x: number; y: number } | null>(null);
	let dragSourceId = $state<string | null>(null);
	/** What had focus when a menu or popover opened, so closing it can hand focus back. */
	let overlayOpener: Element | null = null;
	/** Card the user last moved to with the arrow keys, remembered for the focus it was chosen under. */
	let keyboardCursor = $state<{ focusId: string | null; personId: string } | null>(null);

	const markers = $derived(
		layout.people.length > 0
			? offscreenMarkers(layout.people, transform, size, {
					width: LAYOUT_METRICS.cardWidth,
					height: LAYOUT_METRICS.cardHeight
				})
			: []
	);

	const level = $derived(levelOfDetail(transform.k));
	const peopleById = $derived(new Map(layout.people.map((p) => [p.id, p])));
	const unionById = $derived(new Map(layout.unions.map((u) => [u.id, u])));
	const stubById = $derived(new Map(layout.stubs.map((s) => [s.id, s])));
	/** The one card in the tab order: the keyboard cursor while it is valid, else the focus person. */
	const activeId = $derived(
		keyboardCursor &&
			keyboardCursor.focusId === layout.focusPersonId &&
			peopleById.has(keyboardCursor.personId)
			? keyboardCursor.personId
			: layout.focusPersonId
	);
	const announcement = $derived(
		layout.focusPersonId
			? `Tree focused on ${peopleById.get(layout.focusPersonId)?.person.displayName ?? 'unknown'}. ${layout.people.length} people shown.`
			: ''
	);
	const relations = $derived(new Map(layout.people.map((p) => [p.id, relationLabel(p, layout)])));
	/**
	 * Only the edges and partnerships of the person holding the keyboard cursor are in the tab order,
	 * so Tab walks the card, then its lines, then on to the next control, instead of visiting every line.
	 */
	const tabbableEdgeIds = $derived(
		new Set(
			layout.edges
				.filter((e) =>
					e.kind === 'partner'
						? e.personId === activeId
						: e.kind === 'child' &&
							(e.childId === activeId || e.assertions.some((a) => a.parentId === activeId))
				)
				.map((e) => e.id)
		)
	);
	const tabbableUnionIds = $derived(
		new Set(
			layout.unions
				.filter((u) => activeId && u.union.partnerIds.includes(activeId))
				.map((u) => u.id)
		)
	);
	const collapsedIds = $derived(new Set(layout.collapsedPersonIds));
	const nonAdjacentIds = $derived(new Set(layout.nonAdjacentUnionIds));
	const popoverEdge = $derived(
		popover
			? layout.edges.find((e): e is ChildEdge => e.id === popover!.edgeId && e.kind === 'child')
			: undefined
	);

	function nameOf(personId: string): string {
		return peopleById.get(personId)?.person.displayName ?? personId;
	}

	/** What a screen reader hears on an edge's hit target. */
	function edgeLabel(edge: LayoutEdge): string {
		if (edge.kind === 'partner') {
			const union = unionById.get(edge.unionId);
			const names = union
				? union.union.partnerIds.map(nameOf).join(' and ')
				: nameOf(edge.personId);
			const ordinalTitle = partnershipLabels?.get(edge.unionId)?.title;
			return `Partnership line of ${names}${ordinalTitle ? `, ${ordinalTitle}` : ''}. Press Enter for actions.`;
		}
		if (edge.kind === 'child') {
			return `Parent link to ${nameOf(edge.childId)}, from ${edge.assertions.map((a) => nameOf(a.parentId)).join(' and ')}. Press Enter to review.`;
		}
		return '';
	}

	// ---- Viewport ----

	onMount(() => {
		if (!svgElement || !containerElement) return;
		const detach = viewport.attach(svgElement, () => viewport.frame(layout, false));
		return detach;
	});

	// Re-frame when the key changes; see `TreeViewport.reframe`.
	$effect(() => {
		const key = fitKey;
		const current = layout;
		untrack(() => viewport.reframe(key, current, containerElement?.querySelector('.scene')));
	});

	function panToward(marker: OffscreenMarker) {
		viewport.panBy(marker.pan.x, marker.pan.y);
	}

	/** Pan just enough to bring a card fully into view. */
	function ensureVisible(personId: string) {
		const node = peopleById.get(personId);
		if (node) viewport.ensureVisible(node.x, node.y);
	}

	// ---- Menus, selection and popover ----

	/** Where an event happened in canvas pixels; for the keyboard, the middle of the element it came from. */
	function containerPoint(event: Event): { x: number; y: number } {
		const rect = containerElement?.getBoundingClientRect();
		const mouse = event as MouseEvent;
		if (
			typeof mouse.clientX === 'number' &&
			(mouse.clientX !== 0 || mouse.clientY !== 0 || event.type === 'click')
		) {
			return { x: mouse.clientX - (rect?.left ?? 0), y: mouse.clientY - (rect?.top ?? 0) };
		}
		const element = (event.currentTarget ?? event.target) as Element | null;
		const box = element?.getBoundingClientRect();
		if (!box) return { x: 16, y: 16 };
		return {
			x: box.left + box.width / 2 - (rect?.left ?? 0),
			y: box.top + box.height / 2 - (rect?.top ?? 0)
		};
	}

	function rememberOpener() {
		const active = document.activeElement;
		overlayOpener =
			active && containerElement?.contains(active) && active !== containerElement ? active : null;
	}

	/** Hand focus back to what opened the overlay, or to the card holding the cursor if that is gone. */
	function restoreFocus() {
		const opener = overlayOpener;
		overlayOpener = null;
		const target = opener?.isConnected
			? (opener as HTMLElement | SVGElement)
			: containerElement?.querySelector<SVGGElement>(
					`[data-person-id="${CSS.escape(activeId ?? '')}"]`
				);
		target?.focus({ preventScroll: true });
	}

	function closeOverlays() {
		const wasOverlayOpen = menu !== null || popover !== null;
		menu = null;
		popover = null;
		if (wasOverlayOpen) restoreFocus();
	}

	/** The page's editing actions as one object, for the menu entries shared with the 3D views. */
	const actions = $derived<TreeEditActions>({
		onOpenPerson,
		onEditPerson,
		onDeletePerson,
		onAddRelationship,
		onRecordDeath,
		onEndPartnership,
		onEditUnion,
		onEndUnion,
		onRemoveUnion,
		onMergeUnion,
		mergeableUnionIds
	});

	function openPersonMenu(event: Event, node: PlacedPerson) {
		event.preventDefault();
		const items = personMenuItems(
			{ id: node.id, displayName: node.person.displayName },
			node.person.unionIds.length > 0,
			actions
		);
		popover = null;
		rememberOpener();
		menu = items.length > 0 ? { ...containerPoint(event), items } : null;
	}

	function openUnionMenu(event: Event, union: PlacedUnion) {
		event.preventDefault();
		popover = null;
		const items = unionMenuItems(union.id, actions);
		rememberOpener();
		menu = items.length > 0 ? { ...containerPoint(event), items } : null;
	}

	function openEdgeMenu(edge: LayoutEdge, event: Event) {
		if (edge.kind === 'stub') return;
		event.preventDefault();
		event.stopPropagation();
		selectedEdgeId = edge.id;
		const at = containerPoint(event);
		const items: MenuItem[] = [];
		if (edge.kind === 'partner') {
			if (onEditUnion)
				items.push({ label: 'Edit partnership…', onClick: () => onEditUnion(edge.unionId) });
			if (onEndUnion)
				items.push({ label: 'End partnership…', onClick: () => onEndUnion(edge.unionId) });
			if (onRemoveLink)
				items.push({
					label: 'Remove this partner…',
					isDanger: true,
					onClick: () => onRemoveLink(edge)
				});
		} else {
			items.push({
				label: 'Review parent links…',
				onClick: () => {
					rememberOpener();
					popover = { edgeId: edge.id, ...at };
				}
			});
			if (onRemoveAssertion && edge.assertions.length === 1) {
				items.push({
					label: 'Remove this link…',
					isDanger: true,
					onClick: () => onRemoveAssertion(edge, edge.assertions[0])
				});
			}
		}
		popover = null;
		rememberOpener();
		menu = items.length > 0 ? { ...at, items } : null;
	}

	function onEdgeSelect(edge: LayoutEdge, event: Event) {
		if (edge.kind === 'stub') return;
		event.stopPropagation();
		menu = null;
		selectedEdgeId = edge.id;
		if (edge.kind === 'child') {
			rememberOpener();
			popover = { edgeId: edge.id, ...containerPoint(event) };
		} else {
			// A partnership line has several things to do to it, so activating it lists them.
			openEdgeMenu(edge, event);
		}
	}

	/** Close the menu and hand focus back. Idempotent: focus leaving the menu closes it too. */
	function closeMenu() {
		if (menu === null) return;
		menu = null;
		restoreFocus();
	}

	function changeLinkType(edge: ChildEdge, assertion: ChildAssertion, toType: ParentChildType) {
		closeOverlays();
		onChangeLinkType?.(edge, assertion, toType);
	}

	function removeAssertion(edge: ChildEdge, assertion: ChildAssertion) {
		closeOverlays();
		onRemoveAssertion?.(edge, assertion);
	}

	function onCanvasClick(event: MouseEvent) {
		// The popover and menu are drawn inside this container, so their own clicks bubble here; one
		// on the popover's type <select> would otherwise close it before a new type could be picked.
		if (
			(event.target as Element).closest?.(
				'[data-edge-id], [data-person-id], [data-union-id], [data-stub-id], [data-collapser-id], [role="dialog"], [role="menu"]'
			)
		)
			return;
		selectedEdgeId = null;
		closeOverlays();
	}

	// ---- Drag to relate ----

	function onCardPointerDown(event: PointerEvent, personId: string) {
		if (event.button === 0) dragSourceId = personId;
	}

	function onSvgPointerUp(event: PointerEvent) {
		const sourceId = dragSourceId;
		dragSourceId = null;
		if (!sourceId || !onDragRelate) return;
		const targetId = document
			.elementFromPoint(event.clientX, event.clientY)
			?.closest?.('[data-person-id]')
			?.getAttribute('data-person-id');
		const source = sourceId ? peopleById.get(sourceId) : undefined;
		const target = targetId ? peopleById.get(targetId) : undefined;
		if (source && target && source.id !== target.id) {
			onDragRelate({
				source: { id: source.id, displayName: source.person.displayName },
				target: { id: target.id, displayName: target.person.displayName }
			});
		}
	}

	// ---- Keyboard ----

	async function moveActive(toId: string) {
		keyboardCursor = { focusId: layout.focusPersonId, personId: toId };
		await tick();
		containerElement
			?.querySelector<SVGGElement>(`[data-person-id="${CSS.escape(toId)}"]`)
			?.focus({ preventScroll: true });
		ensureVisible(toId);
	}

	function onKeydown(event: KeyboardEvent) {
		const intent = keyIntentOf({
			key: event.key,
			shiftKey: event.shiftKey,
			altKey: event.altKey,
			target: event.target as Element
		});
		switch (intent.kind) {
			case 'context-menu': {
				// The keyboard's context-menu gesture: open the menu of whatever has focus, next to it.
				const { personId, unionId, edgeId } = intent.target;
				const person = personId ? peopleById.get(personId) : undefined;
				const union = unionId ? layout.unions.find((u) => u.id === unionId) : undefined;
				const edge = edgeId ? layout.edges.find((e) => e.id === edgeId) : undefined;
				if (person) openPersonMenu(event, person);
				else if (union) openUnionMenu(event, union);
				else if (edge) openEdgeMenu(edge, event);
				else return;
				event.preventDefault();
				return;
			}
			case 'escape': {
				const hasOverlay = menu !== null || popover !== null || selectedEdgeId !== null;
				closeOverlays();
				selectedEdgeId = null;
				if (!hasOverlay) onClearSelection?.();
				return;
			}
			case 'delete': {
				if (!selectedEdgeId) return;
				const edge = layout.edges.find((e) => e.id === selectedEdgeId);
				if (edge?.kind === 'partner' && onRemoveLink) {
					event.preventDefault();
					onRemoveLink(edge);
					selectedEdgeId = null;
				} else if (edge?.kind === 'child') {
					event.preventDefault();
					if (edge.assertions.length === 1) onRemoveAssertion?.(edge, edge.assertions[0]);
					else popover = { edgeId: edge.id, x: size.width / 2 - 160, y: size.height / 2 - 80 };
				}
				return;
			}
			case 'move': {
				event.preventDefault();
				const next = neighbourOf(layout, intent.fromId, intent.direction);
				if (next) void moveActive(next);
				return;
			}
		}
	}

	const emptyLabel = 'No people in this tree yet.';
</script>

<!-- Arrow-key handling is delegated from the focusable cards inside; the container itself is not a tab stop. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	bind:this={containerElement}
	class="tree-canvas relative min-h-[28rem] w-full flex-1 overflow-hidden rounded-2xl border border-stone-300/80 shadow-inner"
	style="{treeTokenStyle()}; background: var(--tree-bg);"
	role="application"
	aria-label="Family tree"
	tabindex="-1"
	onclick={onCanvasClick}
	onkeydown={onKeydown}
>
	<div
		class="pointer-events-none absolute inset-0 opacity-40"
		style="background-image: radial-gradient(circle, var(--tree-dot) 1px, transparent 1px); background-size: 24px 24px;"
	></div>

	<svg
		bind:this={svgElement}
		class="absolute inset-0 z-10 h-full w-full cursor-grab select-none active:cursor-grabbing"
		aria-hidden={layout.people.length === 0 ? 'true' : undefined}
		onpointerup={onSvgPointerUp}
		onpointercancel={() => (dragSourceId = null)}
	>
		<g class="scene" transform="translate({transform.x},{transform.y}) scale({transform.k})">
			{#each layout.edges as edge (edge.id)}
				{@const stub = edge.kind === 'stub' ? stubById.get(edge.stubId) : undefined}
				{@const unionId = edge.kind === 'partner' ? edge.unionId : undefined}
				<TreeEdge
					{edge}
					{stub}
					isFromUnion={stub ? stub.unionId !== null : false}
					isUnionEnded={unionId
						? isEndedUnion(unionById.get(unionId)?.union.status ?? 'active')
						: false}
					isSelected={selectedEdgeId === edge.id}
				/>
			{/each}

			{#each layout.unions as union (union.id)}
				<UnionMarker
					{union}
					{level}
					isEnded={isEndedUnion(union.union.status)}
					isNonAdjacent={nonAdjacentIds.has(union.id)}
					label={unionLabelText(union.union)}
					ordinalTitle={partnershipLabels?.get(union.id)?.title}
					zoom={transform.k}
					onContextMenu={openUnionMenu}
				/>
			{/each}

			{#each layout.people as node (node.id)}
				<PersonCard
					{node}
					{level}
					zoom={level === 'block' ? transform.k : 1}
					isFocus={node.id === layout.focusPersonId}
					isSelected={node.id === selectedPersonId}
					isActive={node.id === activeId}
					hasMultiplePaths={collapsedIds.has(node.id)}
					relation={relations.get(node.id) ?? ''}
					onSelect={(id) => onSelectPerson?.(id)}
					onOpen={(id) => onOpenPerson?.(id)}
					onContextMenu={openPersonMenu}
					onPointerDown={onCardPointerDown}
				/>
			{/each}

			<!-- Hit targets come after the cards in the document, so Tab reaches a person's lines and partnerships right after the person. -->
			{#each layout.edges as edge (edge.id)}
				{#if edge.kind !== 'stub'}
					{@const unionId = edge.kind === 'partner' ? edge.unionId : undefined}
					<TreeEdge
						{edge}
						part="target"
						isTabbable={tabbableEdgeIds.has(edge.id)}
						isUnionEnded={unionId
							? isEndedUnion(unionById.get(unionId)?.union.status ?? 'active')
							: false}
						label={edgeLabel(edge)}
						onSelect={onEdgeSelect}
						onContextMenu={openEdgeMenu}
					/>
				{/if}
			{/each}

			{#each layout.unions as union (union.id)}
				<UnionMarker
					{union}
					{level}
					part="target"
					isEnded={isEndedUnion(union.union.status)}
					isNonAdjacent={nonAdjacentIds.has(union.id)}
					isTabbable={tabbableUnionIds.has(union.id)}
					partnerNames={union.union.partnerIds.map(nameOf).join(' and ')}
					label={unionLabelText(union.union)}
					ordinalTitle={partnershipLabels?.get(union.id)?.title}
					zoom={transform.k}
					onOpen={(u) => onEditUnion?.(u.id)}
					onContextMenu={openUnionMenu}
				/>
			{/each}

			{#each layout.stubs as stub (stub.id)}
				<g
					class="stub"
					data-stub-id={stub.id}
					transform="translate({stub.x}, {stub.y})"
					role="button"
					tabindex="0"
					aria-label="Show {stub.count} more {stub.kind === 'ancestors'
						? stub.count === 1
							? 'parent'
							: 'ancestors'
						: stub.count === 1
							? 'child'
							: 'children'}"
					onclick={(event) => {
						event.stopPropagation();
						onExpandStub?.(stub.id);
					}}
					onkeydown={activateOnKey(() => onExpandStub?.(stub.id))}
				>
					<rect
						x={-LAYOUT_METRICS.stubWidth / 2}
						y={-LAYOUT_METRICS.stubHeight / 2}
						width={LAYOUT_METRICS.stubWidth}
						height={LAYOUT_METRICS.stubHeight}
						rx={LAYOUT_METRICS.stubHeight / 2}
					/>
					<text text-anchor="middle" y="5">+{stub.count}</text>
					<title
						>Show {stub.count} more {stub.kind === 'ancestors' ? 'ancestors' : 'children'}</title
					>
				</g>
			{/each}

			{#each layout.collapsers as collapser (collapser.stubId)}
				<g
					class="collapser"
					data-collapser-id={collapser.stubId}
					transform="translate({collapser.x}, {collapser.y})"
					role="button"
					tabindex="0"
					aria-label="Collapse this branch"
					onclick={(event) => {
						event.stopPropagation();
						onCollapseStub?.(collapser.stubId);
					}}
					onkeydown={activateOnKey(() => onCollapseStub?.(collapser.stubId))}
				>
					<circle r="10" />
					<line x1="-5" y1="0" x2="5" y2="0" />
					<title>Collapse this branch</title>
				</g>
			{/each}
		</g>
	</svg>

	{#if layout.people.length === 0}
		<div class="absolute inset-0 z-10 flex items-center justify-center">
			<p class="text-base font-medium text-stone-700">{emptyLabel}</p>
		</div>
	{/if}

	<div class="absolute top-4 left-4 z-20 max-h-[calc(100%-2rem)]">
		<TreeLegend />
	</div>

	<div
		class="absolute right-6 bottom-6 z-20 flex items-center gap-1.5 rounded-xl border border-stone-300 p-1.5 shadow-md"
		style="background: var(--tree-panel);"
	>
		<button
			type="button"
			title="Zoom in"
			aria-label="Zoom in"
			onclick={() => viewport.zoomBy(ZOOM_STEP)}
			class="control"
		>
			<ZoomIn class="h-4 w-4" />
		</button>
		<button
			type="button"
			title="Zoom out"
			aria-label="Zoom out"
			onclick={() => viewport.zoomBy(1 / ZOOM_STEP)}
			class="control"
		>
			<ZoomOut class="h-4 w-4" />
		</button>
		<button
			type="button"
			title={fitLabel}
			aria-label={fitLabel}
			onclick={() => viewport.fitStep(layout)}
			class="control"
		>
			<Maximize2 class="h-4 w-4" />
		</button>
		<span class="px-1 text-xs text-stone-600 tabular-nums" aria-live="off"
			>{Math.round(transform.k * 100)}%</span
		>
	</div>

	<OffscreenMarkers {markers} onPan={panToward} />

	{#if menu}
		<TreeContextMenu items={menu.items} x={menu.x} y={menu.y} onClose={closeMenu} />
	{/if}

	{#if popover && popoverEdge}
		<ParentLinkPopover
			edge={popoverEdge}
			childName={nameOf(popoverEdge.childId)}
			{nameOf}
			x={Math.max(8, Math.min(popover.x, size.width - 336))}
			y={Math.max(8, Math.min(popover.y, size.height - 40 - popoverEdge.assertions.length * 44))}
			onRemove={onRemoveAssertion ? removeAssertion : undefined}
			onChangeType={onChangeLinkType ? changeLinkType : undefined}
			onClose={closeOverlays}
		/>
	{/if}

	<p class="sr-only" aria-live="polite">{announcement}</p>
</div>

<style>
	.control {
		padding: 0.5rem;
		border-radius: 0.5rem;
		color: #57534e;
		cursor: pointer;
	}
	.control:hover {
		background: rgb(231 229 228 / 0.6);
		color: #1c1917;
	}
	.control:focus-visible {
		outline: 2px solid var(--tree-focus-ring);
	}
	.stub {
		cursor: pointer;
		outline: none;
	}
	.stub rect {
		fill: var(--tree-panel);
		stroke: var(--tree-ink-muted);
		stroke-width: 1.5;
	}
	.stub text {
		fill: var(--tree-ink);
		font-size: 13px;
		font-weight: 700;
	}
	.stub:hover rect,
	.stub:focus-visible rect {
		stroke: var(--tree-focus-ring);
		stroke-width: 3;
	}
	.collapser {
		cursor: pointer;
		outline: none;
	}
	.collapser circle {
		fill: var(--tree-panel);
		stroke: var(--tree-ink-muted);
		stroke-width: 1.5;
	}
	.collapser line {
		stroke: var(--tree-ink);
		stroke-width: 2;
		stroke-linecap: round;
	}
	.collapser:hover circle,
	.collapser:focus-visible circle {
		stroke: var(--tree-focus-ring);
		stroke-width: 3;
	}
</style>
