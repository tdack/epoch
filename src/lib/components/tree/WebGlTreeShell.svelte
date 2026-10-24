<script lang="ts" generics="TScene extends WebGlTreeScene">
	import { onMount, untrack, type Snippet } from 'svelte';
	import { clearLabels, labelRank, type LabelBox } from './ring-labels.js';
	import {
		MAX_TRACE_ITEMS,
		type Highlight,
		type HighlightSource,
		type KinSource
	} from '#lib/tree-layout/highlight.js';
	import WebGlHoverCard from './WebGlHoverCard.svelte';
	import TreeContextMenu from './TreeContextMenu.svelte';
	import { personMenuItems, type TreeEditActions } from './tree-actions.js';
	import { createHighlightState } from './webgl-highlight.svelte.js';
	import { RING_TOKENS } from '#lib/shared/tree-tokens.js';
	import { DEFAULT_PALETTE, treeTokenStyle, type Palette } from '#lib/shared/palette.js';
	import { yearsLine, type MenuItem } from './tree-view.js';
	import {
		capitalised,
		sourceLabel,
		type LegendEntry,
		type PickTarget,
		type ShellPerson,
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
		/** The colours to paint with: the user's, the site's, or the built-in ones. */
		palette?: Palette;
		/**
		 * What the highlight is computed over: the layout itself. Its identity matters: a new layout
		 * (a new focus, say) relights the focus line and drops a selection made on the old one.
		 */
		kin: KinSource;
		/** The focus person, whose line is lit until something else is selected; null for the whole tree. */
		focusPersonId: string | null;
		/** The whole tree is drawn: a person lights their line in place and the view does not refocus. */
		isWholeTree?: boolean;
		/** Shows the Whole tree button, pressed while the whole tree is drawn. */
		onToggleWholeTree?: () => void;
		/** The whole tree stopped at its cap. */
		isTruncated?: boolean;
		/** Accessible name of the whole view, such as "Generation rings". */
		label: string;
		/** What the view is called in the WebGL-failure message, such as "Rings". */
		viewName: string;
		/** Completes "Shift+Enter centres … on them" in each name button's accessible name, such as "the rings". */
		subject: string;
		/** Spoken when the focus or the counts change. */
		announcement: string;
		/** Changes when the view should be re-framed; see `TreeCanvas`. */
		fitKey: string;
		/** Camera presets, in button order; the first is the starting one unless `initialCamera` says otherwise. */
		cameras: ReadonlyArray<{ id: string; label: string }>;
		/** The preset the view opens on, when the best first look is not the first button. */
		initialCamera?: string;
		/**
		 * Fetches the mode's scene module and makes the scene; called once on mount. Import three.js
		 * inside it (`import('./x-scene.js')`) so only someone who opens the view pays for it. A
		 * rejection or a throw shows the WebGL-failure message.
		 */
		createScene: (host: HTMLElement) => Promise<TScene>;
		/**
		 * Draws the layout into the scene. Runs whenever the scene appears and whenever anything it
		 * reads changes, so read the layout inside it. `highlight` is what to light: the focus line, a
		 * selection or the trace, or nothing (`isQuiet`) when the viewer has cleared it. `shouldRefit`
		 * is true when `fitKey` changed.
		 */
		applyLayout: (scene: TScene, highlight: Highlight, shouldRefit: boolean) => void;
		/** The scene once created; null before then and after a failure. */
		scene?: TScene | null;
		/**
		 * True under prefers-reduced-motion or the viewer's own "Reduce animation" setting; a scene
		 * that animates anything decorative reads this.
		 */
		shouldReduceMotion?: boolean;
		/** The viewer chose "Reduce animation" in their settings (ADR-054). */
		isMotionReduced?: boolean;
		/** Person marked on the chart: whoever the drawer shows, else the last one clicked. */
		selectedPersonId?: string | null;
		/** Legend entries, shown top left. */
		legend?: LegendEntry[];
		/** The one-line how-to beside the controls, on wide screens. */
		hint?: string;
		/** Extra buttons in the control panel, after Spin. Give them `class="view"`. */
		controls?: Snippet;
		/** A sphere or name was clicked or activated with Enter: mark them; the focus stays put. */
		onSelectPerson?: (id: string) => void;
		/** Double-click or Shift+Enter on a person: focus them and open their details. */
		onOpenPerson?: (id: string) => void;
		/** Escape: drop the selection. */
		onClearSelection?: () => void;
		/**
		 * The page's editing actions for a person's right-click menu; absent entries are left out. Not
		 * `onOpenPerson`: that one here focuses and opens details, the menu's means details only.
		 */
		actions?: TreeEditActions;
	}

	let {
		people,
		palette = DEFAULT_PALETTE,
		kin,
		focusPersonId,
		isWholeTree = false,
		onToggleWholeTree,
		isTruncated = false,
		label,
		viewName,
		subject,
		announcement,
		fitKey,
		cameras,
		initialCamera,
		createScene,
		applyLayout,
		scene = $bindable(null),
		shouldReduceMotion = $bindable(false),
		isMotionReduced = false,
		selectedPersonId = null,
		legend = [],
		hint = 'Drag to orbit · scroll to zoom · right-drag to pan · click empty space to clear the highlight · double-click or hold to focus and see details · right-click for more',
		controls,
		onSelectPerson,
		onOpenPerson,
		onClearSelection,
		actions
	}: Props = $props();

	/** How far a name sits above its sphere's centre, in CSS pixels. */
	const NAME_LIFT_PX = 10;
	/** Pointer travel under which a press counts as a click rather than the start of an orbit. */
	const CLICK_SLOP_PX = 5;
	/** How long a press on a person must be held to count as a long-press. */
	const LONG_PRESS_MS = 500;
	/** Two clicks on one person within this are a double-click. */
	const DOUBLE_CLICK_MS = 400;

	let host = $state<HTMLDivElement>();
	let shell = $state<HTMLDivElement>();
	let didFail = $state(false);
	let camera = $state(untrack(() => initialCamera ?? cameras[0].id));
	let isSpinning = $state(false);
	let shouldShowAllNames = $state(false);
	let hovered = $state.raw<PickTarget | null>(null);
	const hoveredId = $derived(hovered?.kind === 'person' ? hovered.id : null);
	const lit = createHighlightState({
		kin: () => kin,
		focusPersonId: () => focusPersonId,
		palette: () => palette
	});
	const highlight = $derived(lit.highlight);
	const roles = $derived(lit.roles);
	const labelOf = (source: HighlightSource) => sourceLabel(kin, source);
	function sourceFor(target: PickTarget): HighlightSource {
		if (target.kind === 'person') return { kind: 'person', personId: target.id };
		if (target.kind === 'union')
			return { kind: 'union', unionId: target.id, shouldSplitPartners: !lit.isTracing };
		return { kind: 'link', key: target.id };
	}
	/** The pointer inside the canvas, in CSS pixels; null while orbiting or off the canvas. */
	let pointerAt = $state<{ x: number; y: number } | null>(null);
	let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);
	let menuOpener: Element | null = null;
	let shellWidth = $state(0);
	let shellHeight = $state(0);

	/** What a click on a person does, in words, for the hover card and the name buttons. */
	const personAction = $derived(
		lit.isTracing
			? 'Add to or remove from the trace.'
			: isWholeTree
				? 'Light their line.'
				: `Light their line. Shift+Enter centres ${subject} on them and shows their details.`
	);
	/**
	 * Names on screen: the focus line, whoever the pointer is over and the open drawer. Every name at
	 * once crowds a view of more than a dozen, so that is a switch, not the default.
	 */
	const named = $derived(
		people.filter(
			(p) =>
				p.person.isPrivate !== true &&
				(shouldShowAllNames ||
					highlight.people.has(p.id) ||
					p.id === hoveredId ||
					p.id === selectedPersonId)
		)
	);

	/** Spoken (and, for the cap, shown) whenever the selection changes. */
	const statusMessage = $derived.by(() => {
		if (lit.notice) return lit.notice;
		if (lit.isCleared) return 'Highlight cleared: everyone is shown alike.';
		if (lit.isTracing) {
			if (lit.liveTrace.length === 0)
				return `Trace mode on. Click people, partnerships or lines to trace up to ${MAX_TRACE_ITEMS}.`;
			const shared = [...highlight.people.values()].filter((m) => m.isShared).length;
			return `Tracing ${lit.liveTrace.length} of ${MAX_TRACE_ITEMS}: ${lit.liveTrace.map(labelOf).join('; ')}.${
				shared > 0
					? ` ${shared} ${shared === 1 ? 'person is' : 'people are'} on more than one path.`
					: ''
			}`;
		}
		if (lit.activeSelection) {
			const marks = [...highlight.people.values()];
			const count = (kind: string) => marks.filter((m) => m.kind === kind).length;
			return `Selected ${labelOf(lit.activeSelection)}: ${count('ancestor')} ancestors and ${count('descendant')} descendants lit.`;
		}
		return announcement;
	});

	const tags = new Map<string, HTMLElement>();
	/**
	 * Under automation only: an invisible marker at each partnership and line the scene tracks, so
	 * a test can click what has no name button. Nothing else renders or reads them.
	 */
	const isAutomated = typeof navigator !== 'undefined' && navigator.webdriver === true;
	let anchorTargets = $state.raw<PickTarget[]>([]);
	const anchors = new Map<string, { element: HTMLElement; target: PickTarget }>();
	function anchored(target: PickTarget) {
		const key = `${target.kind}:${target.id}`;
		return (element: HTMLElement) => {
			anchors.set(key, { element, target });
			scene?.requestFrame();
			return () => {
				if (anchors.get(key)?.element === element) anchors.delete(key);
			};
		};
	}
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
			const at = scene.project({ kind: 'person', id });
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
		for (const { element, target } of anchors.values()) {
			const at = scene.project(target);
			element.style.display = at ? 'block' : 'none';
			if (at) element.style.translate = `${at.x - 5}px ${at.y - 5}px`;
		}
	}

	let isOsReducingMotion = $state(false);
	// A bindable output, so it is written rather than derived. The setting only adds reduction: it
	// can hold still what the system lets move, and never moves what the system holds still.
	$effect(() => {
		shouldReduceMotion = isOsReducingMotion || isMotionReduced;
	});

	onMount(() => {
		const motion = matchMedia('(prefers-reduced-motion: reduce)');
		isOsReducingMotion = motion.matches;
		const onMotion = (event: MediaQueryListEvent) => {
			isOsReducingMotion = event.matches;
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
		applyLayout(scene, highlight, shouldRefit);
		if (isAutomated) {
			const targets = scene.targets();
			untrack(() => (anchorTargets = targets));
		}
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

	/** Who the last click landed on, for a double-click whose own pick finds nobody. */
	let lastHit: { id: string; x: number; y: number; at: number } | null = null;
	let lastOpenAt = -Infinity;
	/** Opens a person's details and focuses them; one gesture can arrive by two routes, so it acts once. */
	function openPerson(id: string) {
		const now = performance.now();
		if (now - lastOpenAt < DOUBLE_CLICK_MS) return;
		lastOpenAt = now;
		onOpenPerson?.(id);
	}
	let pressTimer: ReturnType<typeof setTimeout> | undefined;
	/** Set when a long-press fired so the release that follows does not also act as a click. */
	let didLongPress = false;
	function cancelPress() {
		clearTimeout(pressTimer);
		pressTimer = undefined;
	}

	/** Opens the person menu at a point inside the shell; private people and empty menus get none. */
	function openPersonMenu(id: string, x: number, y: number) {
		const entry = people.find((p) => p.id === id);
		if (!entry || entry.person.isPrivate === true) return;
		const items = personMenuItems(
			{ id, displayName: entry.person.displayName },
			entry.person.unionIds.length > 0,
			actions ?? {}
		);
		if (items.length === 0) return;
		const active = document.activeElement;
		menuOpener = active && shell?.contains(active) && active !== shell ? active : null;
		// The hover card is z-30 too and would sit over the menu.
		hovered = null;
		pointerAt = null;
		menu = { x, y, items };
	}
	function closeMenu() {
		menu = null;
		const opener = menuOpener;
		menuOpener = null;
		if (opener?.isConnected) (opener as HTMLElement).focus({ preventScroll: true });
	}
	function shellPoint(clientX: number, clientY: number) {
		const rect = shell!.getBoundingClientRect();
		return { x: clientX - rect.left, y: clientY - rect.top };
	}
	function onTagContextMenu(event: MouseEvent, id: string) {
		event.preventDefault();
		// The Menu key and Shift+F10 arrive with no pointer position; the name's middle stands in.
		const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
		const isKeyboard = event.clientX === 0 && event.clientY === 0;
		const { x, y } = shellPoint(
			isKeyboard ? box.left + box.width / 2 : event.clientX,
			isKeyboard ? box.top + box.height / 2 : event.clientY
		);
		openPersonMenu(id, x, y);
	}

	function onPointerDown(event: PointerEvent) {
		closeMenu();
		downAt = { x: event.clientX, y: event.clientY };
		didLongPress = false;
		cancelPress();
		if (!scene || event.button !== 0 || event.ctrlKey || lit.isTracing) return;
		const target = scene.pick(event.clientX, event.clientY, {
			isCoarse: event.pointerType !== 'mouse'
		});
		if (target?.kind !== 'person') return;
		pressTimer = setTimeout(() => {
			didLongPress = true;
			openPerson(target.id);
		}, LONG_PRESS_MS);
	}
	function onPointerUp(event: PointerEvent) {
		cancelPress();
		if (didLongPress) {
			didLongPress = false;
			return;
		}
		// Not the contextmenu event: macOS fires it on mousedown, which would pop the menu at the
		// start of every right-drag pan. Ctrl+click is the same gesture there, and ctrl+drag pans too.
		const isMenuGesture = event.button === 2 || (event.button === 0 && event.ctrlKey);
		if (!scene || !isClick(event) || (event.button !== 0 && !isMenuGesture)) return;
		const target = scene.pick(event.clientX, event.clientY, {
			isCoarse: event.pointerType !== 'mouse'
		});
		if (isMenuGesture) {
			if (target?.kind === 'person') {
				const { x, y } = shellPoint(event.clientX, event.clientY);
				openPersonMenu(target.id, x, y);
			}
			return;
		}
		const previous = lastHit;
		lastHit =
			target?.kind === 'person'
				? { id: target.id, x: event.clientX, y: event.clientY, at: performance.now() }
				: null;
		// The browser's own dblclick is not reliable on a canvas that captures the pointer to orbit,
		// so two clicks on the same person in quick succession are counted here too.
		if (
			lastHit &&
			previous?.id === lastHit.id &&
			lastHit.at - previous.at < DOUBLE_CLICK_MS &&
			Math.hypot(lastHit.x - previous.x, lastHit.y - previous.y) <= CLICK_SLOP_PX
		) {
			lastHit = null;
			openPerson(target!.id);
			return;
		}
		if (target) activate(target);
		// Trace mode keeps what it holds on a stray click; Clear and Escape are for that.
		else if (!lit.isTracing) lit.clearHighlight();
	}
	function onDoubleClick(event: MouseEvent) {
		const target = scene?.pick(event.clientX, event.clientY);
		// The first click relights the scene, which can leave this pick empty for a frame; the
		// click's own hit, at the same spot, says who was meant.
		const isSameSpot =
			lastHit !== null &&
			Math.hypot(event.clientX - lastHit.x, event.clientY - lastHit.y) <= CLICK_SLOP_PX;
		const id = target?.kind === 'person' ? target.id : isSameSpot ? lastHit!.id : null;
		if (id) openPerson(id);
	}
	function onPointerMove(event: PointerEvent) {
		if (
			pressTimer &&
			downAt &&
			Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > CLICK_SLOP_PX
		)
			cancelPress();
		// Touch has no hover; a name appearing under a finger mid-orbit only gets in the way.
		if (event.pointerType !== 'mouse' || !scene) return;
		// A pressed button is an orbit or a pan; a card chasing the drag hides the scene it moves.
		if (event.buttons !== 0) {
			pointerAt = null;
			return;
		}
		const bounds = host!.getBoundingClientRect();
		pointerAt = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
		const target = scene.pick(event.clientX, event.clientY);
		const before = untrack(() => hovered);
		if (target?.kind !== before?.kind || target?.id !== before?.id) hovered = target;
	}
	/** A sphere, marker, line or name was clicked or activated: what that does depends on the mode. */
	function activate(target: PickTarget) {
		if (lit.isTracing) {
			lit.toggleTrace(sourceFor(target));
		} else if (target.kind === 'person') {
			selectPerson(target.id);
		} else {
			lit.select(sourceFor(target));
		}
	}
	function selectPerson(id: string) {
		if (lit.isTracing) {
			lit.toggleTrace({ kind: 'person', personId: id });
		} else {
			// The click no longer moves the focus, so their line is lit in place, as in the whole tree
			// where nobody is the focus. A double-click that refocuses drops this with the old layout.
			lit.select({ kind: 'focus', personId: id });
			onSelectPerson?.(id);
		}
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
		// The menu closes itself; this step back is for it alone.
		if (menu) return;
		// One step back at a time: an open drawer closes first, then trace mode ends (dropping what it
		// held), then the highlight clears.
		if (selectedPersonId) onClearSelection?.();
		else if (lit.isTracing) lit.setTracing(false);
		else lit.clearHighlight();
	}}
/>

<div
	class="webgl-shell relative flex-1 overflow-hidden rounded-2xl border border-[var(--tree-panel-border)]"
	style="{treeTokenStyle(palette)};--ring-partner:{palette.focus
		.partner};background:{RING_TOKENS.stage}"
	role="group"
	aria-label={label}
	bind:this={shell}
	bind:clientWidth={shellWidth}
	bind:clientHeight={shellHeight}
>
	<!-- Pointer only: the names below are the keyboard route to everyone in the view. -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		bind:this={host}
		class="absolute inset-0 touch-none"
		class:cursor-pointer={hovered !== null}
		onpointerdown={onPointerDown}
		onpointerup={onPointerUp}
		onpointermove={onPointerMove}
		onpointercancel={cancelPress}
		onpointerleave={() => {
			cancelPress();
			hovered = null;
			pointerAt = null;
		}}
		ondblclick={onDoubleClick}
		oncontextmenu={(event) => event.preventDefault()}
	></div>

	{#if scene}
		<div class="pointer-events-none absolute inset-0 z-10">
			{#each named as p (p.id)}
				{@const mark = highlight.people.get(p.id)}
				{@const isOnFocusLine =
					highlight.sources[mark?.sourceIndexes[0] ?? -1]?.source.kind === 'focus'}
				{@const role = isOnFocusLine ? (roles.get(p.id) ?? null) : null}
				{@const years = yearsLine(p.person)}
				<button
					type="button"
					class="tag"
					class:is-focus={role === 'focus'}
					class:is-ancestor={role === 'ancestor'}
					class:is-descendant={role === 'descendant'}
					class:is-partner={role === 'partner'}
					class:is-marked={mark !== undefined && !isOnFocusLine}
					class:is-selected={p.id === selectedPersonId}
					style:--mark={mark !== undefined && !isOnFocusLine ? mark.colour : undefined}
					aria-label="{p.person.displayName}{years ? `, ${years}` : ''}. {personAction}"
					onclick={() => selectPerson(p.id)}
					ondblclick={() => onOpenPerson?.(p.id)}
					oncontextmenu={(event) => onTagContextMenu(event, p.id)}
					onkeydown={(event) => onTagKey(event, p.id)}
					{@attach tracked(p.id)}
				>
					{p.person.displayName}
				</button>
			{/each}
		</div>
	{/if}

	<WebGlHoverCard
		{hovered}
		{pointerAt}
		{shellWidth}
		{shellHeight}
		{people}
		{kin}
		{highlight}
		{palette}
		isTracing={lit.isTracing}
		{labelOf}
	/>

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

	{#if isWholeTree && isTruncated}
		<p
			class="absolute top-4 right-4 z-20 max-w-xs rounded-xl border border-[var(--tree-panel-border)] bg-[var(--tree-panel)] px-3 py-1.5 text-xs text-[var(--tree-ink)] shadow-md"
			role="note"
			data-testid="whole-tree-truncated"
		>
			Showing the first {people.length.toLocaleString()} people; the tree has more than this view draws.
		</p>
	{/if}

	{#if isAutomated && scene}
		<div class="pointer-events-none absolute inset-0 z-10" aria-hidden="true">
			{#each anchorTargets as target (`${target.kind}:${target.id}`)}
				<i
					class="anchor"
					data-pick-kind={target.kind}
					data-pick-id={target.id}
					{@attach anchored(target)}
				></i>
			{/each}
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
		class="pointer-events-none absolute inset-x-3 bottom-4 z-20 flex flex-col gap-2 sm:inset-x-6 sm:bottom-6"
	>
		{#if lit.isTracing}
			<div
				class="trace-strip pointer-events-auto flex flex-wrap items-center gap-1.5 self-start rounded-xl border border-[var(--tree-panel-border)] bg-[var(--tree-panel)] p-1.5 text-xs shadow-md"
				role="group"
				aria-label="Traced items"
				data-testid="trace-strip"
			>
				{#if lit.liveTrace.length === 0}
					<span class="px-1 text-[var(--tree-ink-muted)]">
						Click people, partnerships or lines to trace up to {MAX_TRACE_ITEMS}.
					</span>
				{/if}
				{#each lit.liveTrace as item, i (`${i}:${item.kind}`)}
					{@const text = capitalised(labelOf(item))}
					<span class="chip" style:--chip={highlight.sources[i]?.colour} data-testid="trace-chip">
						<i></i>{text}
						<button
							type="button"
							aria-label="Remove {text} from the trace"
							onclick={() => lit.toggleTrace(item)}>×</button
						>
					</span>
				{/each}
				<span class="px-1 text-[var(--tree-ink-muted)]" data-testid="trace-count">
					{lit.liveTrace.length} of {MAX_TRACE_ITEMS}
				</span>
				{#if lit.liveTrace.length > 0}
					<button type="button" class="view" onclick={lit.clearTrace}>Clear</button>
				{/if}
				{#if lit.notice}<span class="px-1 font-medium text-stone-900" role="status"
						>{lit.notice}</span
					>{/if}
			</div>
		{/if}
		<div class="flex flex-wrap items-end justify-between gap-2 sm:flex-nowrap">
			<div
				class="pointer-events-auto flex flex-wrap items-center gap-2 rounded-xl border border-[var(--tree-panel-border)] bg-[var(--tree-panel)] p-1.5 text-xs shadow-md sm:shrink-0"
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
				{#if focusPersonId}
					<button
						type="button"
						class="view"
						aria-pressed={!lit.isCleared}
						onclick={() => (lit.isCleared ? lit.restoreHighlight() : lit.clearHighlight())}
					>
						Focus line
					</button>
				{/if}
				<button
					type="button"
					class="view"
					aria-pressed={lit.isTracing}
					onclick={() => lit.setTracing(!lit.isTracing)}
				>
					Trace
				</button>
				{#if onToggleWholeTree}
					<button type="button" class="view" aria-pressed={isWholeTree} onclick={onToggleWholeTree}>
						Whole tree
					</button>
				{/if}
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
				class="hidden min-w-0 truncate rounded-full border border-[var(--tree-panel-border)] bg-[var(--tree-panel)] px-3 py-1 text-xs text-stone-600 shadow-sm sm:block"
			>
				{lit.isTracing
					? 'Trace: click people, partnerships or lines to add or remove them · Esc ends the trace'
					: hint}
			</p>
		</div>
	</div>

	<p class="sr-only" aria-live="polite">{statusMessage}</p>

	{#if menu}
		<TreeContextMenu items={menu.items} x={menu.x} y={menu.y} onClose={closeMenu} />
	{/if}
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
	.tag.is-marked {
		border: 2px solid var(--mark);
		padding: 0 0.3125rem;
		font-weight: 600;
	}
	.anchor {
		position: absolute;
		top: 0;
		left: 0;
		display: none;
		width: 10px;
		height: 10px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		border: 2px solid var(--chip);
		border-radius: 9999px;
		padding: 0.0625rem 0.25rem 0.0625rem 0.5rem;
		color: var(--tree-ink);
	}
	.chip i {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 9999px;
		background: var(--chip);
	}
	.chip button {
		cursor: pointer;
		border-radius: 9999px;
		padding: 0 0.375rem;
		font-weight: 700;
		line-height: 1.25;
	}
	.chip button:focus-visible {
		outline: 2px solid var(--tree-focus-ring);
		outline-offset: 1px;
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
