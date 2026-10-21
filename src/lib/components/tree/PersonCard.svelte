<script lang="ts">
	import { isActivationKey } from './activate-on-key.js';
	import { LAYOUT_METRICS, type PlacedPerson } from '#lib/tree-layout/index.js';
	import {
		accessibleName,
		dateLines,
		hitSize,
		sexClass,
		sexSymbol,
		blockLabel,
		truncate,
		yearsLine,
		type LevelOfDetail
	} from './tree-view.js';
	import { splitDisplayName } from '#lib/shared/name-types.js';

	interface Props {
		/** The placed person to draw, centred on their layout coordinates. */
		node: PlacedPerson;
		/** How much to draw; chosen by the canvas from the zoom scale. */
		level: LevelOfDetail;
		/** Current zoom scale; only used to keep the click target usable when zoomed out. */
		zoom: number;
		/** True for the person the whole view is centred on. */
		isFocus: boolean;
		/** True for the marked person: the one the drawer shows, else the last one clicked. */
		isSelected: boolean;
		/** True for the one card in the tab order (roving tabindex). */
		isActive: boolean;
		/** True when the person is reached by more than one path (pedigree collapse). */
		hasMultiplePaths: boolean;
		/** Relationship to the focus person ("child", "partner of Alex"), spoken with the name. */
		relation: string;
		/** Click or Enter/Space on the card: mark this person; the focus stays where it is. */
		onSelect: (id: string) => void;
		/** Double-click, long-press or Shift+Enter: focus this person and open their details. */
		onOpen: (id: string) => void;
		/** Right-click; the handler is responsible for `preventDefault`. */
		onContextMenu: (event: MouseEvent, node: PlacedPerson) => void;
	}

	let {
		node,
		level,
		zoom,
		isFocus,
		isSelected,
		isActive,
		hasMultiplePaths,
		relation,
		onSelect,
		onOpen,
		onContextMenu
	}: Props = $props();

	const W = LAYOUT_METRICS.cardWidth;
	const H = LAYOUT_METRICS.cardHeight;

	const person = $derived(node.person);
	/** The name and the "née …" half drawn apart: a full name and its birth surname do not fit one line. */
	const shown = $derived(splitDisplayName(person.displayName));
	const hit = $derived(hitSize(zoom));
	/** Blocks grow a little when zoomed far out so they stay a target, but never touch the next row. */
	const blockHeight = $derived(Math.min(H * 1.6, Math.max(H, 22 / Math.max(zoom, 0.01))));

	/**
	 * Line weights and the focus mark are drawn in layout units, so a card seen at 0.3x would carry a
	 * hairline. The multiplier tracks the level (whose type sizes already scale the same way) to keep
	 * the focus mark about as heavy on screen at every zoom.
	 */
	const scale = $derived(level === 'block' ? 3 : level === 'compact' ? 2 : 1);
	const frameHeight = $derived(level === 'block' ? blockHeight : H);
	const frameRadius = $derived(level === 'block' ? 14 : 12);
	/**
	 * The second rule sits outside the frame: inside it collides with the sex symbol and a long name,
	 * which already run close to the edge at every level.
	 */
	const ruleOutset = $derived(4 * scale);

	const LONG_PRESS_MS = 500;
	const LONG_PRESS_MOVE_TOLERANCE_PX = 8;

	let pressTimer: ReturnType<typeof setTimeout> | undefined;
	let pressOrigin = { x: 0, y: 0 };
	/** Set when a long-press fired so the click that follows the release doesn't also mark. */
	let didLongPress = false;

	function cancelPress() {
		clearTimeout(pressTimer);
		pressTimer = undefined;
	}

	/**
	 * A private placeholder (ADR-015) is drawn so the structure reads, but has no page, no tree of its
	 * own and no relationships a viewer may add to, so nothing on the card acts.
	 */
	const isPrivate = $derived(person.isPrivate === true);

	function onPress(event: PointerEvent) {
		if (isPrivate || event.button !== 0) return;
		didLongPress = false;
		pressOrigin = { x: event.clientX, y: event.clientY };
		cancelPress();
		pressTimer = setTimeout(() => {
			didLongPress = true;
			onOpen(node.id);
		}, LONG_PRESS_MS);
	}

	// A drag is not a press, so movement cancels it.
	function onPressMove(event: PointerEvent) {
		if (!pressTimer) return;
		if (
			Math.hypot(event.clientX - pressOrigin.x, event.clientY - pressOrigin.y) >
			LONG_PRESS_MOVE_TOLERANCE_PX
		) {
			cancelPress();
		}
	}

	function onClick() {
		if (isPrivate) return;
		if (didLongPress) {
			didLongPress = false;
			return;
		}
		onSelect(node.id);
	}

	function onKeydown(event: KeyboardEvent) {
		if (isPrivate) return;
		if (isActivationKey(event)) {
			event.preventDefault();
			if (event.shiftKey) onOpen(node.id);
			else onSelect(node.id);
		}
	}
</script>

<g
	class="card sex-{sexClass(person.sex)}"
	class:is-focus={isFocus}
	class:is-selected={isSelected}
	class:is-private={isPrivate}
	aria-disabled={isPrivate ? 'true' : undefined}
	data-person-id={node.id}
	data-level={level}
	style="--scale: {scale}"
	transform="translate({node.x}, {node.y})"
	role="button"
	tabindex={isActive ? 0 : -1}
	aria-label={accessibleName(node, relation)}
	aria-current={isFocus ? 'true' : undefined}
	onclick={onClick}
	ondblclick={() => {
		if (!isPrivate) onOpen(node.id);
	}}
	oncontextmenu={(event) => {
		cancelPress();
		if (isPrivate) event.preventDefault();
		else onContextMenu(event, node);
	}}
	onpointerdown={onPress}
	onpointermove={onPressMove}
	onpointerup={cancelPress}
	onpointercancel={cancelPress}
	onpointerleave={cancelPress}
	onkeydown={onKeydown}
>
	<rect class="hit" x={-hit.width / 2} y={-hit.height / 2} width={hit.width} height={hit.height} />

	{#if level === 'block'}
		<rect class="frame" x={-W / 2} y={-blockHeight / 2} width={W} height={blockHeight} rx="14" />
		<text class="initial" y="0" text-anchor="middle" dominant-baseline="central">
			{blockLabel(person.displayName)}
		</text>
		<!-- Mirrors the dagger: sex is told by a symbol as well as the tint (Line Before Hue). Decorative
		     because the card's name already carries everything the symbol does for a screen reader. -->
		<text
			class="symbol-block"
			x={-W / 2 + 15}
			y={-blockHeight / 2 + 24}
			text-anchor="middle"
			aria-hidden="true">{sexSymbol(person.sex)}</text
		>
		{#if person.isDeceased}
			<text class="dagger-block" x={W / 2 - 14} y={-blockHeight / 2 + 30} text-anchor="middle"
				>†</text
			>
		{/if}
	{:else if level === 'compact'}
		<rect class="frame" x={-W / 2} y={-H / 2} width={W} height={H} rx="12" />
		<text class="name-compact" x="0" y="-4" text-anchor="middle">
			{truncate(shown.name, 15)}
		</text>
		<text class="dates-compact" x="0" y="24" text-anchor="middle">{yearsLine(person)}</text>
		<!-- On the dates row: the name can run the card's full width, the years rarely do. -->
		<text class="symbol-compact" x={-W / 2 + 20} y="24" text-anchor="middle" aria-hidden="true"
			>{sexSymbol(person.sex)}</text
		>
	{:else}
		<rect class="frame" x={-W / 2} y={-H / 2} width={W} height={H} rx="12" />
		<text class="symbol" x={-W / 2 + 18} y={-H / 2 + 30} text-anchor="middle"
			>{sexSymbol(person.sex)}</text
		>
		{#if shown.birthSurname}
			<!-- Three rows fit the card: the name, the birth surname, then one line of dates. -->
			<text class="name" x={-W / 2 + 34} y={-H / 2 + 26}>{truncate(shown.name, 22)}</text>
			<text class="dates" x={-W / 2 + 34} y={-H / 2 + 43}
				>{truncate(`née ${shown.birthSurname}`, 26)}</text
			>
			<text class="dates" x={-W / 2 + 34} y={-H / 2 + 60}>{yearsLine(person)}</text>
		{:else}
			<text class="name" x={-W / 2 + 34} y={-H / 2 + 30}>{truncate(shown.name, 22)}</text>
			{#each dateLines(person).slice(0, 2) as line, i (i)}
				<text class="dates" x={-W / 2 + 34} y={-H / 2 + 50 + i * 16}>{truncate(line, 26)}</text>
			{/each}
		{/if}
		{#if hasMultiplePaths}
			<g class="badge" transform="translate({W / 2 - 34}, {-H / 2 - 9})">
				<rect x="-22" y="-9" width="44" height="18" rx="9" />
				<text text-anchor="middle" y="4">2 paths</text>
				<title>Also reached by another path</title>
			</g>
		{/if}
	{/if}
	{#if isFocus}
		<!-- Drawn as marks of their own, not as a restyled frame: hover and selection both restyle the
		     frame, and the focus person must still read when either applies. Decorative because
		     aria-current already says it. -->
		<rect
			class="focus-rule"
			x={-W / 2 - ruleOutset}
			y={-frameHeight / 2 - ruleOutset}
			width={W + ruleOutset * 2}
			height={frameHeight + ruleOutset * 2}
			rx={frameRadius + ruleOutset}
			aria-hidden="true"
		/>
		<g
			class="focus-tab"
			transform="translate(0, {-frameHeight / 2 - ruleOutset})"
			aria-hidden="true"
		>
			<rect x={-34 * scale} y={-17 * scale} width={68 * scale} height={20 * scale} rx={4 * scale} />
			<text y={-3 * scale} text-anchor="middle" style="font-size: {11 * scale}px">Focus</text>
		</g>
	{/if}
	<title>{accessibleName(node, relation)}</title>
</g>

<style>
	.card {
		cursor: pointer;
		outline: none;
	}
	.hit {
		fill: transparent;
	}
	.frame {
		stroke-width: 1.75;
		transition: stroke-width 120ms;
	}
	.sex-m .frame {
		fill: var(--sex-m);
		stroke: var(--sex-m-border);
	}
	.sex-f .frame {
		fill: var(--sex-f);
		stroke: var(--sex-f-border);
	}
	.sex-u .frame {
		fill: var(--sex-u);
		stroke: var(--sex-u-border);
	}
	.card:hover .frame {
		stroke-width: 3;
	}
	.is-private {
		cursor: default;
		opacity: 0.7;
	}
	.is-private .frame {
		stroke-dasharray: 6 4;
	}
	.is-private:hover .frame {
		stroke-width: 1.75;
	}
	.is-private .name,
	.is-private .name-compact {
		font-style: italic;
		font-weight: 500;
	}
	/* The heavier ink frame is half of the focus mark (the outer rule and tab are the rest). The
	   :hover twin is needed because the plain hover rule outranks this one and would thin the frame. */
	.is-focus .frame,
	.is-focus:hover .frame {
		stroke: var(--tree-ink);
		stroke-width: calc(3 * var(--scale));
	}
	.is-selected .frame,
	.is-selected:hover .frame {
		stroke: var(--tree-accent);
		stroke-width: calc(3.5 * var(--scale));
	}
	.focus-rule {
		fill: none;
		stroke: var(--tree-ink);
		stroke-width: calc(1.25 * var(--scale));
		pointer-events: none;
	}
	.focus-tab {
		pointer-events: none;
	}
	.focus-tab rect {
		fill: var(--tree-ink);
	}
	.focus-tab text {
		fill: var(--tree-bg);
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.card:focus-visible .frame {
		stroke: var(--tree-focus-ring);
		stroke-width: 4;
		stroke-dasharray: none;
	}
	.symbol {
		fill: var(--tree-ink-muted);
		font-size: 20px;
	}
	.name {
		fill: var(--tree-ink);
		font-size: 14px;
		font-weight: 700;
	}
	.dates {
		fill: var(--tree-ink-muted);
		font-size: 12px;
	}
	.name-compact {
		fill: var(--tree-ink);
		font-size: 26px;
		font-weight: 700;
	}
	.dates-compact {
		fill: var(--tree-ink-muted);
		font-size: 22px;
	}
	.initial {
		fill: var(--tree-ink);
		font-size: 48px;
		font-weight: 700;
	}
	.symbol-compact {
		fill: var(--tree-ink-muted);
		font-size: 22px;
	}
	.symbol-block {
		fill: var(--tree-ink-muted);
		/* Smaller than the dagger and set higher, so a six-letter initial still clears it. */
		font-size: 24px;
	}
	.dagger-block {
		fill: var(--tree-ink-muted);
		font-size: 30px;
	}
	.badge rect {
		fill: var(--tree-panel);
		stroke: var(--tree-ink-muted);
	}
	.badge text {
		fill: var(--tree-ink);
		font-size: 10px;
		font-weight: 600;
	}
</style>
