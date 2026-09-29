<script lang="ts">
	import { LAYOUT_METRICS, type PlacedUnion } from '#lib/tree-layout/index.js';
	import type { LevelOfDetail } from './tree-view.js';

	interface Props {
		/** The placed union node. */
		union: PlacedUnion;
		/** Marriage text is hidden at the smallest level of detail. */
		level: LevelOfDetail;
		/** True when the union has separated, divorced, been annulled or otherwise ended. */
		isEnded: boolean;
		/** True when a partner could not sit next to the node, so the connectors are drawn as brackets. */
		isNonAdjacent: boolean;
		/** Which half to draw: the picture (under the cards) or the focusable hit target (after them). */
		part?: 'visual' | 'target';
		/** True for the partnerships of the person who holds the keyboard cursor; only those are in the tab order. */
		isTabbable?: boolean;
		/** Names of the partners, for the accessible name. */
		partnerNames?: string;
		/** Label under the node: how the partnership began and ended. */
		label?: string;
		/** "2nd partnership" for a pair with several; read out and shown as a short "2nd" beside the dates. */
		ordinalTitle?: string;
		/** Click, Enter or Space: open the partnership editor. */
		onOpen?: (union: PlacedUnion) => void;
		/** Right-click; the handler is responsible for `preventDefault`. */
		onContextMenu: (event: MouseEvent, union: PlacedUnion) => void;
	}

	let {
		union,
		level,
		isEnded,
		isNonAdjacent,
		part = 'visual',
		isTabbable = false,
		partnerNames = '',
		label = '',
		ordinalTitle,
		onOpen,
		onContextMenu
	}: Props = $props();

	const R = LAYOUT_METRICS.unionRadius;
	const shownLabel = $derived([ordinalTitle?.split(' ')[0], label].filter(Boolean).join(' · '));
	const description = $derived(
		`${ordinalTitle ? ordinalTitle.charAt(0).toUpperCase() + ordinalTitle.slice(1) : 'Partnership'}${partnerNames ? ` of ${partnerNames}` : ''}, ${union.union.status}${label ? `, ${label}` : ''}${isNonAdjacent ? ', shown below the row' : ''}`
	);
</script>

{#if part === 'target'}
	<g
		class="target"
		data-union-id={union.id}
		transform="translate({union.x}, {union.y})"
		role="button"
		tabindex={isTabbable ? 0 : -1}
		aria-label="{description}. Press Enter to edit."
		onclick={(event) => {
			event.stopPropagation();
			onOpen?.(union);
		}}
		onkeydown={(event) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				onOpen?.(union);
			}
		}}
		oncontextmenu={(event) => onContextMenu(event, union)}
	>
		<circle r={R + 5} fill="transparent" />
		<circle class="focus-ring" r={R + 5} />
	</g>
{:else}
<g
	class="union"
	class:ended={isEnded}
	transform="translate({union.x}, {union.y})"
	role="img"
	aria-hidden="true"
>
	<circle class="disc" r={R} />
	<circle class="ring" cx="-3.2" r="4.6" />
	<circle class="ring" cx="3.2" r="4.6" />
	{#if isEnded}
		<!-- End marker: a slash through the rings, matching the dashed connectors. -->
		<line class="end-mark" x1={-R * 0.7} y1={R * 0.7} x2={R * 0.7} y2={-R * 0.7} />
	{/if}
</g>
{#if shownLabel && level !== 'block'}
	<!-- A hanging node sits under the card row, with partner connectors arriving level with it on both
	sides, so its label goes below and to the right where only the child edge's other side is free. -->
	<text
		class="label"
		x={union.isHanging ? union.x + 6 : union.x}
		y={union.isHanging ? union.y + R + 11 : union.y - LAYOUT_METRICS.cardHeight / 2 - 6}
		text-anchor={union.isHanging ? 'start' : 'middle'}
	>
		{shownLabel}
	</text>
{/if}
{/if}

<style>
	.union {
		pointer-events: none;
	}
	.target {
		cursor: pointer;
		outline: none;
	}
	.focus-ring {
		fill: none;
		stroke: transparent;
		stroke-width: 3;
	}
	.target:focus-visible .focus-ring,
	.target:hover .focus-ring {
		stroke: var(--tree-focus-ring);
	}
	.disc {
		fill: var(--union-fill);
		stroke: var(--union-ink);
		stroke-width: 2;
	}
	.ended .disc {
		stroke-dasharray: 4 3;
	}
	.ring {
		fill: none;
		stroke: var(--union-ink);
		stroke-width: 1.5;
	}
	.end-mark {
		stroke: var(--union-ink);
		stroke-width: 2.5;
		stroke-linecap: round;
	}
	.label {
		fill: var(--union-ink);
		font-size: 11px;
		font-weight: 600;
		pointer-events: none;
	}
</style>
