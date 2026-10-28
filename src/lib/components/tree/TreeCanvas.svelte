<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { ChevronUp, Download, Printer } from '@lucide/svelte';
	import Popover from '#lib/components/layout/Popover.svelte';
	import { requestPrint } from '#lib/components/layout/print.js';
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
	import TreeMinimap from './TreeMinimap.svelte';
	import UnionMarker from './UnionMarker.svelte';
	import ZoomControls from './ZoomControls.svelte';
	import { dateFormatReader } from '#lib/components/date-format.js';
	import { DEFAULT_PALETTE, treeTokenStyle, type Palette } from '#lib/shared/palette.js';
	import type { PartnershipLabel } from '#lib/shared/partnership-labels.js';
	import { activateOnKey } from './activate-on-key.js';
	import { POSTER_MARGIN_MM, posterSheet, type PosterSheet } from './poster.js';
	import { keyIntentOf } from './tree-keyboard.js';
	import {
		personMenuItems,
		unionMenuItems,
		type PersonRef,
		type TreeEditActions
	} from './tree-actions.js';
	import { isWholeVisible, visibleRect } from './minimap.js';
	import { NARROW_CANVAS_PX, TreeViewport } from './tree-viewport.svelte.js';
	import { FIT_ACTIONS, offscreenMarkers, type OffscreenMarker } from './view-geometry.js';
	import {
		isEndedUnion,
		levelOfDetail,
		type LevelOfDetail,
		neighbourOf,
		relationLabel,
		unionLabelText,
		type MenuItem
	} from './tree-view.js';

	interface Props {
		/** Positioned people, unions, stubs and edges from `layoutFocusView`. */
		layout: TreeLayout;
		/** The colours to paint with: the user's, the site's, or the built-in ones. */
		palette?: Palette;
		/**
		 * Changes when the view should be re-framed (a new focus, edited data, changed options) and
		 * deliberately not when a stub is expanded, so opening a branch does not move the view.
		 */
		fitKey: string;
		/** The signed-in member's own person, marked "You" on their card. */
		selfPersonId?: string | null;
		/** Person marked with the green border: whoever the drawer shows, else the last one clicked. */
		selectedPersonId?: string | null;
		/** A card was clicked or activated with Enter/Space: mark it, without moving the focus. */
		onSelectPerson?: (id: string) => void;
		/** Double-click, long-press or Shift+Enter on a person: focus them and open their details. */
		onOpenPerson?: (id: string) => void;
		/** "Show details" in a card's menu: open the drawer on them without refocusing. */
		onShowPerson?: (id: string) => void;
		/** The context menu's Open full page: go to the person's own page. */
		onOpenProfile?: (id: string) => void;
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
		/** A "+N" stub was activated; the caller adds its id to the expanded set. */
		onExpandStub?: (stubId: string) => void;
		/** A collapse control was activated; the caller removes the id. */
		onCollapseStub?: (stubId: string) => void;
		/** The whole tree is drawn (`layoutWholeTree`): nobody is the focus. */
		isWholeTree?: boolean;
		/** Shows the Whole tree button, pressed while the whole tree is drawn. */
		onToggleWholeTree?: () => void;
		/** The whole tree stopped at its cap. */
		isTruncated?: boolean;
	}

	let {
		layout,
		palette = DEFAULT_PALETTE,
		fitKey,
		selfPersonId = null,
		selectedPersonId = null,
		onSelectPerson,
		onOpenPerson,
		onShowPerson,
		onOpenProfile,
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
		onExpandStub,
		onCollapseStub,
		isWholeTree = false,
		onToggleWholeTree,
		isTruncated = false
	}: Props = $props();

	const dateFormat = dateFormatReader();
	const ZOOM_STEP = 1.35;

	let containerElement: HTMLDivElement | null = $state(null);
	let svgElement: SVGSVGElement | null = $state(null);
	const viewport = new TreeViewport();
	/** Dot spacing on the flat canvas, in CSS pixels. */
	const DOT_GRID_PX = 22;
	const transform = $derived(viewport.transform);
	const size = $derived(viewport.size);
	// Not on a phone, where it would cover the cards it maps, and not while the whole tree shows.
	const shouldShowMinimap = $derived(
		layout.people.length > 0 &&
			size.width >= NARROW_CANVAS_PX &&
			!isWholeVisible(layout.bounds, visibleRect(transform, size))
	);
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
	const sheet = $derived(layout.people.length > 0 ? posterSheet(layout.bounds) : null);
	const posterLabel = $derived(
		sheet
			? `Print as a poster, ${Math.round(sheet.widthMm)} × ${Math.round(sheet.heightMm)} mm with cards ${Math.round(sheet.cardWidthMm)} mm wide`
			: 'Print as a poster'
	);
	// Drawn only while printing: a second full-detail copy of a big tree is too heavy to keep around.
	let isPrinting = $state(false);
	let isPrintUnavailable = $state(false);

	let isDownloading = $state(false);
	let didDownloadFail = $state(false);
	let posterSvg = $state<SVGSVGElement | null>(null);

	/**
	 * Draws the poster and returns the function that takes it away. Never from `beforeprint`: during a
	 * real print Chrome refuses the Trusted Types call Svelte makes to build new markup, so a poster
	 * drawn there prints blank and the failure takes the page down with it.
	 */
	async function showPoster(size: PosterSheet): Promise<() => void> {
		// The page size is the drawing's own, and CSS cannot take a variable inside `size`.
		const pageRule = document.createElement('style');
		pageRule.textContent = `@page tree-poster { size: ${size.widthMm}mm ${size.heightMm}mm; margin: ${POSTER_MARGIN_MM}mm; @bottom-right { content: none; } }`;
		document.head.appendChild(pageRule);
		isPrinting = true;
		await tick();
		return () => {
			pageRule.remove();
			isPrinting = false;
		};
	}

	async function printPoster() {
		if (!sheet || isPrinting) return;
		isPrintUnavailable = false;
		didDownloadFail = false;
		const hide = await showPoster(sheet);
		const done = () => {
			window.removeEventListener('afterprint', done);
			hide();
		};
		window.addEventListener('afterprint', done);
		requestPrint(() => {
			done();
			isPrintUnavailable = true;
		});
	}

	async function downloadPoster() {
		if (!sheet || isPrinting) return;
		isPrintUnavailable = false;
		didDownloadFail = false;
		isDownloading = true;
		const size = sheet;
		const hide = await showPoster(size);
		try {
			const { posterPdf } = await import('./poster-pdf.js');
			const url = URL.createObjectURL(await posterPdf(posterSvg!, size));
			const link = document.createElement('a');
			link.href = url;
			link.download = `${document.title.split(' · ')[0] || 'Family tree'} poster.pdf`;
			link.click();
			// Revoked later: Safari reads the file after the click returns.
			setTimeout(() => URL.revokeObjectURL(url), 60_000);
		} catch {
			didDownloadFail = true;
		} finally {
			hide();
			isDownloading = false;
		}
	}

	/** Cmd-P or Ctrl-P prints the poster too; the browser's own print would only get the note. */
	function onWindowKeydown(event: KeyboardEvent) {
		if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'p' || !sheet) return;
		event.preventDefault();
		void printPoster();
	}

	/** Moves the poster to the end of the body, where app.css can print it alone. */
	function toBody(node: HTMLElement) {
		document.body.appendChild(node);
		return { destroy: () => node.remove() };
	}
	const peopleById = $derived(new Map(layout.people.map((p) => [p.id, p])));
	const unionById = $derived(new Map(layout.unions.map((u) => [u.id, u])));
	const stubById = $derived(new Map(layout.stubs.map((s) => [s.id, s])));
	/** The one card in the tab order: the keyboard cursor while it is valid, else the focus person. */
	const activeId = $derived(
		keyboardCursor &&
			keyboardCursor.focusId === layout.focusPersonId &&
			peopleById.has(keyboardCursor.personId)
			? keyboardCursor.personId
			: // The whole tree has no focus; without a fallback no card would be in the tab order.
				(layout.focusPersonId ?? layout.people[0]?.id ?? null)
	);
	const announcement = $derived(
		layout.focusPersonId
			? `Tree focused on ${peopleById.get(layout.focusPersonId)?.person.displayName ?? 'unknown'}. ${layout.people.length} people shown.`
			: isWholeTree && layout.people.length > 0
				? `Showing the whole tree: ${layout.people.length} people.`
				: ''
	);
	const relations = $derived(new Map(layout.people.map((p) => [p.id, relationLabel(p, layout)])));
	/**
	 * Only the edges, partnerships, "+N" stubs and collapsers of the person holding the keyboard cursor
	 * are in the tab order, so Tab walks the card, then its lines, then on to the next control, instead
	 * of visiting every line and stub. The stubs stay clickable and reachable once the cursor arrives.
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
		onOpenPerson: onShowPerson,
		onOpenProfile,
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

<svelte:window onkeydown={onWindowKeydown} />

{#snippet scene(lvl: LevelOfDetail, k: number, isPrint: boolean)}
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
			isSelected={!isPrint && selectedEdgeId === edge.id}
		/>
	{/each}

	{#each layout.unions as union (union.id)}
		<UnionMarker
			{union}
			level={lvl}
			isEnded={isEndedUnion(union.union.status)}
			isNonAdjacent={nonAdjacentIds.has(union.id)}
			label={unionLabelText(union.union, dateFormat())}
			ordinalTitle={partnershipLabels?.get(union.id)?.title}
			zoom={k}
			onContextMenu={openUnionMenu}
		/>
	{/each}

	{#each layout.people as node (node.id)}
		<PersonCard
			{node}
			level={lvl}
			zoom={lvl === 'block' ? k : 1}
			isSelf={node.id === selfPersonId}
			isFocus={node.id === layout.focusPersonId}
			isSelected={!isPrint && node.id === selectedPersonId}
			isActive={!isPrint && node.id === activeId}
			hasMultiplePaths={collapsedIds.has(node.id)}
			relation={relations.get(node.id) ?? ''}
			onSelect={(id) => onSelectPerson?.(id)}
			onOpen={(id) => onOpenPerson?.(id)}
			onContextMenu={openPersonMenu}
		/>
	{/each}
{/snippet}

<!-- Arrow-key handling is delegated from the focusable cards inside; the container itself is not a tab stop. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	bind:this={containerElement}
	class="tree-canvas relative min-h-[28rem] w-full flex-1 overflow-hidden rounded-2xl border border-stone-300/80 shadow-inner"
	style="{treeTokenStyle(palette)}; background: var(--tree-bg);"
	role="application"
	aria-label="Family tree"
	tabindex="-1"
	onclick={onCanvasClick}
	onkeydown={onKeydown}
>
	<!-- Follows the pan (not the zoom, which would alias the grid) so dragging slides the dots under the cards. -->
	<div
		class="pointer-events-none absolute inset-0"
		style="background-image: radial-gradient(circle, var(--tree-dot) 1.5px, transparent 1.5px); background-size: {DOT_GRID_PX}px {DOT_GRID_PX}px; background-position: {transform.x %
			DOT_GRID_PX}px {transform.y % DOT_GRID_PX}px;"
	></div>

	<svg
		bind:this={svgElement}
		class="absolute inset-0 z-10 h-full w-full cursor-grab select-none active:cursor-grabbing"
		aria-hidden={layout.people.length === 0 ? 'true' : undefined}
	>
		<g class="scene" transform="translate({transform.x},{transform.y}) scale({transform.k})">
			{@render scene(level, transform.k, false)}

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
					label={unionLabelText(union.union, dateFormat())}
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
					tabindex={stub.personId === activeId ? 0 : -1}
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
					tabindex={collapser.personId === activeId ? 0 : -1}
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

	{#if isWholeTree && isTruncated}
		<p
			class="absolute top-4 right-4 z-20 max-w-xs rounded-xl border border-[var(--tree-panel-border)] bg-[var(--tree-panel)] px-3 py-1.5 text-xs text-[var(--tree-ink)] shadow-md"
			role="note"
			data-testid="whole-tree-truncated"
		>
			Showing the first {layout.people.length.toLocaleString()} people; the tree has more than this view
			draws.
		</p>
	{/if}

	<ZoomControls
		scale={transform.k}
		{fitLabel}
		onZoomIn={() => viewport.zoomBy(ZOOM_STEP)}
		onZoomOut={() => viewport.zoomBy(1 / ZOOM_STEP)}
		onFit={() => viewport.fitStep(layout)}
	>
		{#snippet leading()}
			{#if sheet}
				<div class="flex items-center" role="group" aria-label="Poster">
					<button
						type="button"
						class="poster"
						title={posterLabel}
						aria-label={posterLabel}
						disabled={isDownloading}
						onclick={printPoster}
					>
						<Printer class="h-4 w-4" />
					</button>
					<Popover label="Poster options" align="end" isAbove panelClass="w-56 py-1">
						{#snippet trigger(attrs)}
							<button
								type="button"
								{...attrs}
								class="poster narrow"
								aria-label="More poster options"
							>
								<ChevronUp class="h-3.5 w-3.5" />
							</button>
						{/snippet}
						<button type="button" role="menuitem" class="poster-item" onclick={printPoster}>
							<Printer class="h-4 w-4" />Print
						</button>
						<button
							type="button"
							role="menuitem"
							class="poster-item"
							disabled={isDownloading}
							onclick={downloadPoster}
						>
							<Download class="h-4 w-4" />{isDownloading ? 'Making the PDF…' : 'Download PDF'}
						</button>
					</Popover>
				</div>
			{/if}
			{#if onToggleWholeTree}
				<button
					type="button"
					class="whole-tree"
					aria-pressed={isWholeTree}
					onclick={onToggleWholeTree}
				>
					Whole tree
				</button>
			{/if}
		{/snippet}
	</ZoomControls>

	{#if shouldShowMinimap}
		<TreeMinimap
			{layout}
			{transform}
			{size}
			onCentre={(x, y, isAnimated) => viewport.centreOn(x, y, isAnimated)}
		/>
	{/if}

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

	{#if isDownloading || didDownloadFail}
		<p
			role="status"
			class="absolute right-6 bottom-20 z-20 max-w-xs rounded-lg border border-stone-300 bg-white p-2 text-xs text-stone-700 shadow-md"
		>
			{isDownloading
				? 'Making the poster PDF…'
				: 'The poster PDF could not be made. Try again, or print it instead.'}
		</p>
	{/if}
	{#if isPrintUnavailable}
		<p
			role="status"
			class="absolute right-6 bottom-20 z-20 max-w-xs rounded-lg border border-stone-300 bg-white p-2 text-xs text-stone-700 shadow-md"
		>
			This app window can't print.
			<a class="text-link" href={location.href} target="_blank" rel="noopener"
				>Open this page in the browser</a
			>
			and print from there.
		</p>
	{/if}

	<p class="sr-only" aria-live="polite">{announcement}</p>
</div>

{#if isPrinting && sheet}
	<div
		use:toBody
		data-tree-poster
		aria-hidden="true"
		inert
		class="hidden items-center justify-center print:flex"
		style="{treeTokenStyle(palette)}; width: {sheet.widthMm -
			2 * POSTER_MARGIN_MM}mm; height: {sheet.heightMm - 2 * POSTER_MARGIN_MM - 1}mm;"
	>
		<svg
			bind:this={posterSvg}
			viewBox={sheet.viewBox}
			width="{sheet.drawingWidthMm}mm"
			height="{sheet.drawingHeightMm}mm"
			style="max-height: 100%;"
		>
			{@render scene('full', 1, true)}
		</svg>
	</div>
{/if}

<style>
	.poster {
		padding: 0.5rem;
		border-radius: 0.5rem;
		color: #57534e;
		cursor: pointer;
	}
	.poster:hover {
		background: rgb(231 229 228 / 0.6);
		color: #1c1917;
	}
	.poster.narrow {
		padding-inline: 0.25rem;
	}
	.poster:disabled {
		cursor: progress;
		opacity: 0.5;
	}
	.poster-item {
		display: flex;
		width: 100%;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		font-size: 0.875rem;
		text-align: left;
		cursor: pointer;
	}
	.poster-item:hover {
		background: rgb(245 245 244);
	}
	.poster-item:disabled {
		cursor: progress;
		opacity: 0.6;
	}
	.poster:focus-visible {
		outline: 2px solid var(--tree-focus-ring);
	}
	@media (pointer: coarse) {
		.poster {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			min-width: 2.75rem;
			min-height: 2.75rem;
		}
	}
	/* Matches the WebGL views' Whole tree toggle, so the one control reads the same in every view. */
	.whole-tree {
		padding: 0.25rem 0.625rem;
		border-radius: 0.5rem;
		border: 1px solid var(--tree-panel-border);
		color: #44403c;
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
	}
	.whole-tree[aria-pressed='true'] {
		background: var(--color-emerald-800);
		border-color: var(--color-emerald-800);
		color: var(--color-amber-50);
	}
	.whole-tree:focus-visible {
		outline: 2px solid var(--tree-focus-ring);
		outline-offset: 2px;
	}
	@media (pointer: coarse) {
		.whole-tree {
			min-height: 2.75rem;
		}
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
