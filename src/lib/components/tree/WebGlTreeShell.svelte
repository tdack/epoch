<script lang="ts" generics="TScene extends WebGlTreeScene">
	import { onMount, untrack, type Snippet } from 'svelte';
	import { clearLabels, labelRank, type LabelBox } from './ring-labels.js';
	import {
		computeHighlight,
		isSourcePresent,
		linkKey,
		MAX_TRACE_ITEMS,
		QUIET_HIGHLIGHT,
		toggleTraceItem,
		type Highlight,
		type HighlightSource,
		type KinSource
	} from '#lib/tree-layout/highlight.js';
	import { RING_TOKENS } from './tree-tokens.js';
	import { DEFAULT_PALETTE, treeTokenStyle, type Palette } from './palette.js';
	import { yearsLine } from './tree-view.js';
	import {
		describeMark,
		highlightRoles,
		hoverCard,
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
		/** The viewer chose "Reduce animation" in their settings (ADR-053). */
		isMotionReduced?: boolean;
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
		createScene,
		applyLayout,
		scene = $bindable(null),
		shouldReduceMotion = $bindable(false),
		isMotionReduced = false,
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
	let hovered = $state.raw<PickTarget | null>(null);
	const hoveredId = $derived(hovered?.kind === 'person' ? hovered.id : null);
	/**
	 * A partnership, line or (in the whole tree) person selected outside trace mode, with the layout
	 * it was made on: a new layout drops it, as a new focus has always relit the focus line.
	 */
	let selection = $state.raw<{ kin: KinSource; source: HighlightSource } | null>(null);
	/** The layout the viewer cleared the highlight on; clearing keeps everyone where they are. */
	let clearedKin = $state.raw<KinSource | null>(null);
	const isHighlightCleared = $derived(clearedKin === kin);
	let isTracing = $state(false);
	/** What trace mode holds. Kept across layouts; what a layout does not draw is simply not lit. */
	let traceItems = $state.raw<HighlightSource[]>([]);
	/** Said in the trace strip and announced: the cap was hit. */
	let notice = $state<string | null>(null);
	const liveTrace = $derived(traceItems.filter((item) => isSourcePresent(kin, item)));
	const activeSelection = $derived(selection?.kin === kin ? selection.source : null);
	const highlight = $derived.by<Highlight>(() => {
		if (isHighlightCleared) return QUIET_HIGHLIGHT;
		if (isTracing) return computeHighlight(kin, liveTrace, true, palette);
		if (activeSelection) return computeHighlight(kin, [activeSelection], false, palette);
		return focusPersonId
			? computeHighlight(kin, [{ kind: 'focus', personId: focusPersonId }], false, palette)
			: QUIET_HIGHLIGHT;
	});
	/** Roles at the level the scenes light people: see {@link highlightRoles}. */
	const roles = $derived(highlightRoles(highlight));
	function clearHighlight() {
		clearedKin = kin;
	}
	const labelOf = (source: HighlightSource) => sourceLabel(kin, source);
	/** "the partnership of A and B" as a title: "Partnership of A and B". */
	const capitalised = (text: string) => {
		const bare = text.replace(/^the /, '');
		return bare.charAt(0).toUpperCase() + bare.slice(1);
	};
	function sourceFor(target: PickTarget): HighlightSource {
		if (target.kind === 'person') return { kind: 'person', personId: target.id };
		if (target.kind === 'union')
			return { kind: 'union', unionId: target.id, shouldSplitPartners: !isTracing };
		return { kind: 'link', key: target.id };
	}
	function toggleTrace(source: HighlightSource) {
		const change = toggleTraceItem(liveTrace, source);
		if (change.result === 'full') {
			notice = `Trace holds at most ${MAX_TRACE_ITEMS} items. Remove one to add another.`;
			return;
		}
		notice = null;
		clearedKin = null;
		traceItems = change.items;
	}
	function setTracing(isOn: boolean) {
		isTracing = isOn;
		notice = null;
		selection = null;
		clearedKin = null;
		if (!isOn) traceItems = [];
	}
	/** The pointer inside the canvas, in CSS pixels; null while orbiting or off the canvas. */
	let pointerAt = $state<{ x: number; y: number } | null>(null);
	let shellWidth = $state(0);
	let shellHeight = $state(0);
	let cardWidth = $state(0);
	let cardHeight = $state(0);

	const personById = $derived(new Map(people.map((p) => [p.id, p])));
	const hoveredPerson = $derived(hoveredId ? personById.get(hoveredId) : undefined);
	/** Why the item under the pointer is lit, if it is. */
	const hoveredMark = $derived.by(() => {
		if (!hovered) return null;
		const marks =
			hovered.kind === 'person'
				? highlight.people
				: hovered.kind === 'union'
					? highlight.unions
					: highlight.links;
		const mark = marks.get(hovered.id);
		return mark ? describeMark(mark, highlight, labelOf) : null;
	});
	const card = $derived(
		hoveredPerson && hoveredPerson.person.isPrivate !== true
			? hoverCard(hoveredPerson.person, people, hoveredMark)
			: null
	);
	/** The card for a partnership or a line: a title and a line or two, never a private person's name. */
	const itemCard = $derived.by(() => {
		if (!hovered || hovered.kind === 'person') return null;
		if (hovered.kind === 'union') {
			const union = kin.unions.find((u) => u.id === hovered!.id);
			if (!union) return null;
			const children = kin.childLinks.filter((l) => l.fromUnionId === union.id).length;
			return {
				title: capitalised(
					labelOf({ kind: 'union', unionId: union.id, shouldSplitPartners: true })
				),
				meta: `${union.partnerIds.length} ${union.partnerIds.length === 1 ? 'partner' : 'partners'} · ${children} ${children === 1 ? 'child' : 'children'} in view`,
				hint: isTracing
					? 'Click to add to or remove from the trace'
					: 'Click to light this partnership'
			};
		}
		const link = kin.childLinks.find((l) => linkKey(l) === hovered!.id);
		if (!link) return null;
		return {
			title: capitalised(labelOf({ kind: 'link', key: hovered.id })),
			meta: 'A parent-child line',
			hint: isTracing ? 'Click to add to or remove from the trace' : 'Click to light this line'
		};
	});
	/** What a click on a person does, in words, for the hover card and the name buttons. */
	const personAction = $derived(
		isTracing
			? 'Add to or remove from the trace.'
			: isWholeTree
				? 'Light their line.'
				: `Centre ${subject} on them.`
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
		if (person.sex === 'M') return palette.sex.male.sphere;
		if (person.sex === 'F') return palette.sex.female.sphere;
		return palette.sex.unknown.sphere;
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
					highlight.people.has(p.id) ||
					p.id === hoveredId ||
					p.id === selectedPersonId)
		)
	);

	/** Spoken (and, for the cap, shown) whenever the selection changes. */
	const statusMessage = $derived.by(() => {
		if (notice) return notice;
		if (isHighlightCleared) return 'Highlight cleared: everyone is shown alike.';
		if (isTracing) {
			if (liveTrace.length === 0)
				return `Trace mode on. Click people, partnerships or lines to trace up to ${MAX_TRACE_ITEMS}.`;
			const shared = [...highlight.people.values()].filter((m) => m.isShared).length;
			return `Tracing ${liveTrace.length} of ${MAX_TRACE_ITEMS}: ${liveTrace.map(labelOf).join('; ')}.${
				shared > 0
					? ` ${shared} ${shared === 1 ? 'person is' : 'people are'} on more than one path.`
					: ''
			}`;
		}
		if (activeSelection) {
			const marks = [...highlight.people.values()];
			const count = (kind: string) => marks.filter((m) => m.kind === kind).length;
			return `Selected ${labelOf(activeSelection)}: ${count('ancestor')} ancestors and ${count('descendant')} descendants lit.`;
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

	function onPointerDown(event: PointerEvent) {
		downAt = { x: event.clientX, y: event.clientY };
	}
	function onPointerUp(event: PointerEvent) {
		if (!scene || !isClick(event) || event.button !== 0) return;
		const target = scene.pick(event.clientX, event.clientY, {
			isCoarse: event.pointerType !== 'mouse'
		});
		if (target) activate(target);
		// Trace mode keeps what it holds on a stray click; Clear and Escape are for that.
		else if (!isTracing) clearHighlight();
	}
	function onDoubleClick(event: MouseEvent) {
		const target = scene?.pick(event.clientX, event.clientY);
		if (target?.kind === 'person') onOpenPerson?.(target.id);
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
		const target = scene.pick(event.clientX, event.clientY);
		const before = untrack(() => hovered);
		if (target?.kind !== before?.kind || target?.id !== before?.id) hovered = target;
	}
	/** A sphere, marker, line or name was clicked or activated: what that does depends on the mode. */
	function activate(target: PickTarget) {
		if (isTracing) {
			toggleTrace(sourceFor(target));
		} else if (target.kind === 'person') {
			selectPerson(target.id);
		} else {
			selection = { kin, source: sourceFor(target) };
			clearedKin = null;
		}
	}
	function selectPerson(id: string) {
		if (isTracing) {
			toggleTrace({ kind: 'person', personId: id });
		} else if (isWholeTree) {
			// Nobody is the focus here, so a person lights their line where they stand.
			selection = { kin, source: { kind: 'focus', personId: id } };
			clearedKin = null;
		} else {
			selection = null;
			clearedKin = null;
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
		// One step back at a time: an open drawer closes first, then trace mode ends (dropping what it
		// held), then the highlight clears.
		if (selectedPersonId) onClearSelection?.();
		else if (isTracing) setTracing(false);
		else clearHighlight();
	}}
/>

<div
	class="webgl-shell relative flex-1 overflow-hidden rounded-2xl border border-[var(--tree-panel-border)]"
	style="{treeTokenStyle(palette)};--ring-partner:{palette.focus
		.partner};background:{RING_TOKENS.stage}"
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
		class:cursor-pointer={hovered !== null}
		onpointerdown={onPointerDown}
		onpointerup={onPointerUp}
		onpointermove={onPointerMove}
		onpointerleave={() => {
			hovered = null;
			pointerAt = null;
		}}
		ondblclick={onDoubleClick}
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
					onkeydown={(event) => onTagKey(event, p.id)}
					{@attach tracked(p.id)}
				>
					{p.person.displayName}
				</button>
			{/each}
		</div>
	{/if}

	{#if (card || itemCard) && cardAt}
		<!-- Pointer only, so hidden from assistive tech: a name's own label carries its years. -->
		<div
			class="hover-card pointer-events-none absolute top-0 left-0 z-30"
			style="translate:{cardAt.x}px {cardAt.y}px"
			aria-hidden="true"
			data-testid="hover-card"
			bind:offsetWidth={cardWidth}
			bind:offsetHeight={cardHeight}
		>
			{#if card && hoveredPerson}
				{@const years = yearsLine(hoveredPerson.person)}
				<p class="name">{card.name}</p>
				{#if years}<p class="years">{years}</p>{/if}
				<p class="meta">
					<i style="background:{sexColourOf(hoveredPerson.person)}"
					></i>{card.sex}{#if card.roleLabel}<span class="sep">·</span>{card.roleLabel}{/if}
				</p>
				<p class="meta">
					{card.partnershipCount}
					{card.partnershipCount === 1 ? 'partnership' : 'partnerships'}<span class="sep">·</span
					>{card.childrenInView}
					{card.childrenInView === 1 ? 'child' : 'children'} in view
				</p>
				<p class="hint">
					{isTracing
						? 'Click to add to or remove from the trace'
						: isWholeTree
							? 'Click to light their line'
							: 'Click to centre'} · double-click for details
				</p>
			{:else if itemCard}
				<p class="name">{itemCard.title}</p>
				<p class="meta">{itemCard.meta}</p>
				{#if hoveredMark}<p class="meta">{hoveredMark}</p>{/if}
				<p class="hint">{itemCard.hint}</p>
			{/if}
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
		{#if isTracing}
			<div
				class="trace-strip pointer-events-auto flex flex-wrap items-center gap-1.5 self-start rounded-xl border border-[var(--tree-panel-border)] bg-[var(--tree-panel)] p-1.5 text-xs shadow-md"
				role="group"
				aria-label="Traced items"
				data-testid="trace-strip"
			>
				{#if liveTrace.length === 0}
					<span class="px-1 text-[var(--tree-ink-muted)]">
						Click people, partnerships or lines to trace up to {MAX_TRACE_ITEMS}.
					</span>
				{/if}
				{#each liveTrace as item, i (`${i}:${item.kind}`)}
					{@const text = capitalised(labelOf(item))}
					<span class="chip" style:--chip={highlight.sources[i]?.colour} data-testid="trace-chip">
						<i></i>{text}
						<button
							type="button"
							aria-label="Remove {text} from the trace"
							onclick={() => toggleTrace(item)}>×</button
						>
					</span>
				{/each}
				<span class="px-1 text-[var(--tree-ink-muted)]" data-testid="trace-count">
					{liveTrace.length} of {MAX_TRACE_ITEMS}
				</span>
				{#if liveTrace.length > 0}
					<button
						type="button"
						class="view"
						onclick={() => {
							traceItems = [];
							notice = null;
						}}>Clear</button
					>
				{/if}
				{#if notice}<span class="px-1 font-medium text-stone-900" role="status">{notice}</span>{/if}
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
						aria-pressed={!isHighlightCleared}
						onclick={() => (isHighlightCleared ? (clearedKin = null) : clearHighlight())}
					>
						Focus line
					</button>
				{/if}
				<button
					type="button"
					class="view"
					aria-pressed={isTracing}
					onclick={() => setTracing(!isTracing)}
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
				{isTracing
					? 'Trace: click people, partnerships or lines to add or remove them · Esc ends the trace'
					: hint}
			</p>
		</div>
	</div>

	<p class="sr-only" aria-live="polite">{statusMessage}</p>
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
	.hover-card {
		max-width: 16rem;
		border: 1px solid var(--tree-panel-border);
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
