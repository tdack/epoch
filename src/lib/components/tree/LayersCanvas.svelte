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
	import GenerationRail from './GenerationRail.svelte';
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
		projectToScreen,
		type LayerView
	} from './plane-stack.js';
	import { foldWideRows, isBoxInView, type FoldMark as FoldMarkSpec } from './plane-scale.js';
	import { CAMERA_TOKENS } from './tree-tokens.js';
	import { childLinks, type PlaneNav } from './plane-keyboard.js';
	import {
		DIVE_DIRECTIONS,
		DiveIntent,
		currentFamily,
		parentFamilies,
		reconcileTrail,
		wheelZoomLog2,
		type DiveDirection,
		type DiveTarget,
		type TrailEntry
	} from './dive.js';
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
		/** Move a generation back or forward: re-centre on this person and partnership. */
		onTravel?: (to: { focusId: string; unionId: string | null }) => void;
	}

	let {
		layout: incomingLayout,
		fitKey: incomingFitKey,
		selectedPersonId = null,
		onSelectPerson,
		onOpenPerson,
		onClearSelection,
		onExpandStub,
		onCollapseStub,
		actions = {},
		partnershipLabels,
		onDragRelate,
		isSinglePlane = false,
		onTravel
	}: Props = $props();

	/**
	 * The view on screen while a move by generation flies out. A fast load would otherwise swap the
	 * new family in mid-flight; held, it waits for the exit to finish and then arrives whole.
	 */
	let held = $state.raw<{ layout: LayersLayout; fitKey: string } | null>(null);
	const layout = $derived(held?.layout ?? incomingLayout);
	const fitKey = $derived(held?.fitKey ?? incomingFitKey);

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
	/**
	 * Layers stops zooming here rather than at the flat view's limit: cards read well before it, and
	 * pushing on past it is what dives a generation back.
	 */
	const LAYERS_MAX_ZOOM = 2;
	/** How long the pushed-past-the-limit hint stays after the wheel stops. */
	const PUSH_HINT_MS = 1400;
	const TRAVEL_EXIT_MS = 460;
	const TRAVEL_ARRIVE_MS = 620;
	/** The new view is asked for this far into the exit, so most of the load hides behind it. */
	const TRAVEL_REQUEST_SHARE = 0.55;
	/** A move that has not landed by then (a failed load) unwinds rather than hang mid-flight. */
	const TRAVEL_GIVE_UP_MS = 8000;

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
	/** Read out with the new focus, so a move is announced as one. */
	let travelNote = $state('');
	const announcement = $derived(
		layout.focusPersonId
			? `${travelNote ? `${travelNote} ` : ''}Tree focused on ${peopleById.get(layout.focusPersonId)?.person.displayName ?? 'unknown'}, shown as layers. ${layout.people.length} people shown.`
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

	// ---- Travelling by generation (see `dive.ts`) ----
	let rigElement: HTMLDivElement | null = $state(null);
	const families = $derived(parentFamilies(layout));
	const here = $derived(currentFamily(layout));
	/** Families dived out of, oldest dive first; the last is one generation forward. */
	let trail = $state<TrailEntry[]>([]);
	const later = $derived([...trail].reverse());
	/** Set from the start of a move until the new view is in place. */
	let travel = $state<{ direction: DiveDirection } | null>(null);
	let pendingDive: { target: DiveTarget; from: TrailEntry } | null = null;
	let exitAnimations: Animation[] = [];
	let arrival: Animation | null = null;
	let travelTimers: ReturnType<typeof setTimeout>[] = [];

	const intent = new DiveIntent();
	let pushDirection = $state<DiveDirection | null>(null);
	let pushProgress = $state(0);
	let pushFamilyIndex = $state(0);
	let pushHintUntil = 0;
	let pushFrame = 0;

	const focusId = $derived(layout.focusPersonId);
	$effect(() => {
		const id = focusId;
		untrack(() => {
			trail = reconcileTrail(trail, id, pendingDive);
			pendingDive = null;
			if (!travel) travelNote = '';
		});
	});

	// Stop at the fit going out, so pushing on past it can surface; see `LAYERS_MAX_ZOOM` for in.
	$effect(() => {
		void viewport.size;
		viewport.setZoomLimits(viewport.fitScale(framing), LAYERS_MAX_ZOOM);
	});

	function canAnimate(): boolean {
		return (
			typeof matchMedia === 'function' &&
			!matchMedia('(prefers-reduced-motion: reduce)').matches &&
			!document.hidden
		);
	}

	/** Where a point of a plane lands in the canvas, through the camera, the pan and the zoom. */
	function screenOf(at: { plane: Band; generation: number; x: number }, dy = 0) {
		const { rotateXDeg, rotateYDeg } = CAMERA_TOKENS[layerCamera(layerView)];
		const p = projectToScreen(
			layerPoint(at.plane, at.generation, at.x, layerView, M, dy),
			rotateXDeg,
			rotateYDeg
		);
		const [x, y] = transform.apply([p.x, p.y]);
		return { x, y };
	}

	/** The family behind the front plane nearest a point of the canvas. */
	function nearestFamily(point: { x: number; y: number }): number {
		let best = 0;
		let bestDistance = Infinity;
		families.forEach((family, i) => {
			const at = screenOf(family.at);
			const distance = Math.hypot(at.x - point.x, at.y - point.y);
			if (distance < bestDistance) [best, bestDistance] = [i, distance];
		});
		return best;
	}

	/** The family the keyboard dives to: the side the cursor stands on, else the first partner's. */
	function keyboardFamily(): DiveTarget | undefined {
		const cursor = activeId;
		return (
			families.find((f) => f.childId === cursor) ??
			families.find((f) => {
				const union = f.unionId ? unionById.get(f.unionId) : undefined;
				return f.focusId === cursor || !!union?.union.partnerIds.includes(cursor ?? '');
			}) ??
			families[0]
		);
	}

	function clearTravelTimers() {
		for (const timer of travelTimers) clearTimeout(timer);
		travelTimers = [];
	}

	function unwindTravel() {
		clearTravelTimers();
		for (const animation of exitAnimations) animation.cancel();
		exitAnimations = [];
		pendingDive = null;
		held = null;
		travel = null;
	}

	/**
	 * Fly a generation back (through the front plane, toward `origin`) or forward (pulling back from
	 * it), then ask for the new view. The flight holds its last frame until the view arrives, so the
	 * load reads as part of the move.
	 */
	function travelTo(
		direction: DiveDirection,
		to: { focusId: string; unionId: string | null },
		origin: { x: number; y: number }
	) {
		if (travel || !onTravel) return;
		arrival?.cancel();
		arrival = null;
		travel = { direction };
		travelNote =
			direction === DIVE_DIRECTIONS.IN ? 'Back one generation.' : 'Forward one generation.';
		intent.reset();
		pushDirection = null;
		pushProgress = 0;
		const rig = rigElement;
		if (!rig || !canAnimate()) {
			onTravel(to);
		} else {
			rig.style.transformOrigin = `${origin.x}px ${origin.y}px`;
			const timing = { duration: TRAVEL_EXIT_MS, fill: 'forwards' as const };
			const front = rig.querySelector('[data-plane-key="0"]');
			const back = rig.querySelectorAll('.plane:not([data-plane-key="0"])');
			if (direction === DIVE_DIRECTIONS.IN) {
				// Accelerate into the front plane and through it: it swells, blurs and is gone, and the
				// family behind is what is left in view.
				exitAnimations = [
					rig.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.7)' }], {
						...timing,
						easing: 'cubic-bezier(0.55, 0, 0.75, 0.2)'
					}),
					...(front
						? [
								front.animate(
									[
										{ opacity: 1, filter: 'blur(0px)' },
										{ opacity: 0, filter: 'blur(10px)' }
									],
									{ ...timing, duration: TRAVEL_EXIT_MS * 0.7, easing: 'ease-in' }
								)
							]
						: []),
					...[...rig.querySelectorAll('.connector')].map((line) =>
						line.animate([{ opacity: 1 }, { opacity: 0 }], { ...timing, duration: 200 })
					)
				];
			} else {
				// Pull back from the front plane: the stack shrinks away and the planes behind it go first.
				exitAnimations = [
					rig.animate(
						[
							{ transform: 'scale(1)', opacity: 1 },
							{ transform: 'scale(0.62)', opacity: 0.55 }
						],
						{ ...timing, easing: 'cubic-bezier(0.55, 0, 0.75, 0.2)' }
					),
					...[...back].map((plane) =>
						plane.animate([{ opacity: 1 }, { opacity: 0 }], {
							...timing,
							duration: TRAVEL_EXIT_MS * 0.6
						})
					)
				];
			}
			held = { layout: incomingLayout, fitKey: incomingFitKey };
			void Promise.all(exitAnimations.map((a) => a.finished)).then(
				() => (held = null),
				() => undefined
			);
			travelTimers.push(setTimeout(() => onTravel(to), TRAVEL_EXIT_MS * TRAVEL_REQUEST_SHARE));
		}
		travelTimers.push(setTimeout(unwindTravel, TRAVEL_GIVE_UP_MS));
	}

	/**
	 * The new view is on screen (the exit has finished: until then `held` kept the old one). Drop the
	 * exit's last frame and bring the new stack in from the far side in the same frame.
	 */
	function arrive() {
		const direction = travel?.direction;
		clearTravelTimers();
		const rig = rigElement;
		for (const animation of exitAnimations) animation.cancel();
		exitAnimations = [];
		if (rig && direction && canAnimate()) {
			rig.style.transformOrigin = '50% 45%';
			const entering =
				direction === DIVE_DIRECTIONS.IN
					? { transform: 'scale(0.8)', opacity: 0, filter: 'blur(6px)' }
					: { transform: 'scale(1.3)', opacity: 0, filter: 'blur(6px)' };
			arrival = rig.animate(
				[entering, { transform: 'scale(1)', opacity: 1, filter: 'blur(0px)' }],
				{ duration: TRAVEL_ARRIVE_MS, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
			);
		}
		// The new family is in place: the next move may start while it is still settling.
		travel = null;
	}

	function diveTo(target: DiveTarget) {
		const from = here;
		if (!from) return;
		pendingDive = { target, from };
		travelTo(DIVE_DIRECTIONS.IN, target, screenOf(target.at));
	}

	/** Surface to `later[index]`: the nearest family dived out of is index 0. */
	function surfaceTo(index: number) {
		const entry = later[index];
		if (!entry) return;
		const card = peopleById.get(entry.focusId);
		travelTo(
			DIVE_DIRECTIONS.OUT,
			entry,
			card ? screenOf(card) : { x: viewport.size.width / 2, y: viewport.size.height / 2 }
		);
	}

	function tickPush() {
		const now = performance.now();
		pushProgress = intent.progressAt(now);
		if (now > pushHintUntil && pushProgress === 0) {
			pushDirection = null;
			pushFrame = 0;
			return;
		}
		pushFrame = requestAnimationFrame(tickPush);
	}

	/**
	 * The wheel past the end of the zoom. d3-zoom ignores a wheel event once the zoom is at its limit,
	 * so this listens first (in the capture phase) and only takes the events d3 would drop.
	 */
	function onWheel(event: WheelEvent) {
		if (travel) {
			event.preventDefault();
			return;
		}
		const zoomLog2 = wheelZoomLog2(event);
		if (zoomLog2 === 0 || !onTravel) return;
		const direction = zoomLog2 > 0 ? DIVE_DIRECTIONS.IN : DIVE_DIRECTIONS.OUT;
		const { min, max } = viewport.zoomLimits;
		const k = viewport.transform.k;
		const isAtLimit =
			direction === DIVE_DIRECTIONS.IN
				? families.length > 0 && k >= max * 0.995
				: trail.length > 0 && k <= min * 1.005;
		const now = performance.now();
		if (isAtLimit) {
			// The page must not scroll, nor a pinch zoom the whole page, while the push gathers.
			event.preventDefault();
			if (direction === DIVE_DIRECTIONS.IN) {
				const box = containerElement?.getBoundingClientRect();
				pushFamilyIndex = nearestFamily({
					x: event.clientX - (box?.left ?? 0),
					y: event.clientY - (box?.top ?? 0)
				});
			}
			pushDirection = direction;
			pushHintUntil = now + PUSH_HINT_MS;
			if (!pushFrame) pushFrame = requestAnimationFrame(tickPush);
		}
		const go = intent.push(now, zoomLog2, isAtLimit);
		if (go === DIVE_DIRECTIONS.IN) diveTo(families[pushFamilyIndex] ?? families[0]);
		else if (go === DIVE_DIRECTIONS.OUT) surfaceTo(0);
	}

	/** Page Up dives a generation back and Page Down surfaces, wherever the zoom stands. */
	function onKeydown(event: KeyboardEvent) {
		const target = event.target as Element | null;
		const isTyping = !!target?.closest?.('input, textarea, select, [contenteditable="true"]');
		if (!isTyping && !event.altKey && !event.ctrlKey && !event.metaKey) {
			if (event.key === 'PageUp') {
				event.preventDefault();
				const family = keyboardFamily();
				if (family) diveTo(family);
				return;
			}
			if (event.key === 'PageDown') {
				event.preventDefault();
				surfaceTo(0);
				return;
			}
		}
		interactions.onKeydown(event);
	}

	/** What the push past the limit is about to do, drawn on the family it will land on. */
	const pushHalo = $derived.by(() => {
		if (!pushDirection) return null;
		if (pushDirection === DIVE_DIRECTIONS.IN) {
			const family = families[pushFamilyIndex];
			if (!family) return null;
			const union = family.unionId ? unionById.get(family.unionId) : undefined;
			return {
				direction: pushDirection,
				label: family.label,
				plane: family.at.plane,
				shape: union ? ('ring' as const) : ('card' as const),
				x: family.at.x,
				y: union ? unionY(union) : family.at.generation * M.rowHeight
			};
		}
		const entry = later[0];
		const card = entry ? peopleById.get(entry.focusId) : undefined;
		if (!entry) return null;
		return {
			direction: pushDirection,
			label: entry.label,
			plane: card?.plane ?? null,
			shape: 'card' as const,
			x: card?.x ?? 0,
			y: (card?.generation ?? 0) * M.rowHeight
		};
	});

	onMount(() => {
		const element = containerElement;
		if (!element) return;
		element.addEventListener('wheel', onWheel, { capture: true, passive: false });
		return () => {
			element.removeEventListener('wheel', onWheel, { capture: true });
			cancelAnimationFrame(pushFrame);
			clearTravelTimers();
		};
	});

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
		return viewport.attach(surfaceElement, () => viewport.frame(framing, false));
	});

	// Re-frame when the key changes; see `TreeViewport.reframe`. A move by generation brings in its
	// own stack, so the re-frame's fade is left out of it.
	$effect(() => {
		const key = fitKey;
		const current = framing;
		untrack(() => {
			viewport.reframe(key, current, travel ? null : surfaceElement);
			if (travel) arrive();
		});
	});
</script>

<!-- Arrow-key handling is delegated from the focusable cards inside; the container itself is not a tab stop. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	bind:this={containerElement}
	class="tree-canvas layers-canvas relative min-h-[28rem] w-full flex-1 overflow-hidden rounded-2xl border border-stone-300/80 shadow-inner"
	style="{treeTokenStyle()}; background: var(--tree-bg);"
	role="application"
	aria-label="Family tree, layers view"
	tabindex="-1"
	onkeydown={onKeydown}
	onpointerup={interactions.onPointerUp}
	onpointercancel={interactions.onPointerCancel}
>
	<div
		class="pointer-events-none absolute inset-0 opacity-40"
		style="background-image: radial-gradient(circle, var(--tree-dot) 1px, transparent 1px); background-size: 24px 24px;"
	></div>

	<div
		bind:this={surfaceElement}
		class="scene surface absolute inset-0 z-10 h-full w-full cursor-grab select-none active:cursor-grabbing"
	>
		<div bind:this={rigElement} class="rig">
			<PlaneStack
				{planes}
				{connectors}
				camera={layerCamera(layerView)}
				{transform}
				settleKey={fitKey}
				shouldSettle={!travel}
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

							{#if pushHalo && pushHalo.plane === band}
								<g
									class="push-halo"
									class:out={pushHalo.direction === DIVE_DIRECTIONS.OUT}
									transform="translate({pushHalo.x}, {pushHalo.y})"
									aria-hidden="true"
								>
									{#if pushHalo.shape === 'ring'}
										<circle class="track" r={30 + pushProgress * 6} />
										<circle
											class="fill"
											r={30 + pushProgress * 6}
											pathLength="1"
											stroke-dasharray="{pushProgress} 1"
											transform="rotate(-90)"
										/>
									{:else}
										<rect
											class="track"
											x={-M.cardWidth / 2 - 8}
											y={-M.cardHeight / 2 - 8}
											width={M.cardWidth + 16}
											height={M.cardHeight + 16}
											rx="16"
										/>
										<rect
											class="fill"
											x={-M.cardWidth / 2 - 8}
											y={-M.cardHeight / 2 - 8}
											width={M.cardWidth + 16}
											height={M.cardHeight + 16}
											rx="16"
											pathLength="1"
											stroke-dasharray="{pushProgress} 1"
										/>
									{/if}
								</g>
							{/if}
						{/if}
					</g>
				{/snippet}
			</PlaneStack>
		</div>
	</div>

	{#if pushHalo}
		<!-- Hidden from screen readers: Page Up and Page Down do the same, and the move is announced. -->
		<div
			class="pointer-events-none absolute inset-x-0 top-4 z-30 flex justify-center px-4"
			aria-hidden="true"
		>
			<span class="push-hint">
				<span class="truncate"
					>{pushHalo.direction === DIVE_DIRECTIONS.IN
						? 'Keep zooming in to go back to'
						: 'Keep zooming out to return to'}
					<span class="font-semibold text-stone-900">{pushHalo.label}</span></span
				>
				<span class="meter" style:transform="scaleX({pushProgress})"></span>
			</span>
		</div>
	{/if}

	{#if onTravel && (families.length > 0 || trail.length > 0)}
		<div class="absolute top-4 right-4 z-20">
			<GenerationRail
				earlier={families}
				current={here}
				{later}
				nameOf={(id) => peopleById.get(id)?.person.displayName ?? 'someone not shown'}
				onBack={diveTo}
				onForward={surfaceTo}
				isTravelling={!!travel}
			/>
		</div>
	{/if}

	{#if layout.people.length === 0}
		<div class="absolute inset-0 z-10 flex items-center justify-center">
			<p class="text-base font-medium text-stone-700">No people in this tree yet.</p>
		</div>
	{/if}

	<div class="absolute top-4 left-4 z-20 max-h-[calc(100%-2rem)]">
		<TreeLegend />
	</div>

	<!--
		One bottom bar for both overlays. Pinned apart they ran under each other at 375px; here the
		zoom bar stacks above the plane controls on a phone and sits opposite them from sm up.
	-->
	<div
		class="pointer-events-none absolute inset-x-3 bottom-4 z-20 flex flex-col-reverse items-start gap-2 sm:inset-x-6 sm:bottom-6 sm:flex-row sm:items-end sm:justify-between"
	>
		<!-- With one plane there is nothing to choose between; a lone tab read as a stray control. -->
		{#if !isSinglePlane || layout.planes.length > 1}
			<div
				class="pointer-events-auto flex min-w-0 flex-wrap items-center gap-3 rounded-xl border border-stone-300 p-2 text-xs shadow-md"
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
		{/if}

		<ZoomControls
			scale={transform.k}
			onZoomIn={() => viewport.zoomBy(ZOOM_STEP)}
			onZoomOut={() => viewport.zoomBy(1 / ZOOM_STEP)}
			onFit={() => viewport.fit(framing)}
			class="pointer-events-auto relative shrink-0 self-end"
		/>
	</div>

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
	/* The same selected state as the toolbar's layout buttons: emerald marks what is chosen. */
	.view[aria-pressed='true'] {
		background: var(--color-emerald-800);
		border-color: var(--color-emerald-800);
		color: var(--color-amber-50);
	}
	.view:focus-visible {
		outline: 2px solid var(--tree-focus-ring);
		outline-offset: 2px;
	}
	.rig {
		position: absolute;
		inset: 0;
	}
	.push-halo {
		pointer-events: none;
	}
	.push-halo .track,
	.push-halo .fill {
		fill: none;
		stroke: var(--union-ink);
	}
	.push-halo .track {
		stroke-width: 1.5;
		stroke-dasharray: 4 5;
		opacity: 0.55;
	}
	.push-halo .fill {
		stroke-width: 4;
		stroke-linecap: round;
	}
	.push-halo.out .track,
	.push-halo.out .fill {
		stroke: var(--color-emerald-800);
	}
	.push-hint {
		position: relative;
		display: flex;
		max-width: 100%;
		overflow: hidden;
		border: 1px solid var(--tree-panel-border);
		border-radius: 9999px;
		background: var(--tree-panel);
		padding: 0.25rem 0.875rem;
		font-size: 0.875rem;
		color: #44403c;
		box-shadow: var(--shadow-md);
	}
	.push-hint .meter {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 3px;
		background: var(--union-ink);
		transform-origin: 0 50%;
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
