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
		/** Right-click; the handler is responsible for `preventDefault`. */
		onContextMenu: (event: MouseEvent, union: PlacedUnion) => void;
	}

	let { union, level, isEnded, isNonAdjacent, onContextMenu }: Props = $props();

	const R = LAYOUT_METRICS.unionRadius;
	const label = $derived(union.union.marriageDate || union.union.marriagePlace || '');
	const description = $derived(
		`Partnership, ${union.union.status}${label ? `, ${label}` : ''}${isNonAdjacent ? ', shown below the row' : ''}`
	);
</script>

<g
	class="union"
	class:ended={isEnded}
	data-union-id={union.id}
	transform="translate({union.x}, {union.y})"
	role="img"
	aria-label={description}
	oncontextmenu={(event) => onContextMenu(event, union)}
>
	<circle class="disc" r={R} />
	<circle class="ring" cx="-3.2" r="4.6" />
	<circle class="ring" cx="3.2" r="4.6" />
	{#if isEnded}
		<!-- End marker: a slash through the rings, matching the dashed connectors. -->
		<line class="end-mark" x1={-R * 0.7} y1={R * 0.7} x2={R * 0.7} y2={-R * 0.7} />
	{/if}
	<title>{description}</title>
</g>
{#if label && level !== 'block'}
	<!-- A hanging node sits under the card row, with partner connectors arriving level with it on both
	sides, so its label goes below and to the right where only the child edge's other side is free. -->
	<text
		class="label"
		x={union.isHanging ? union.x + 6 : union.x}
		y={union.isHanging ? union.y + R + 11 : union.y - LAYOUT_METRICS.cardHeight / 2 - 6}
		text-anchor={union.isHanging ? 'start' : 'middle'}
	>
		{label}
	</text>
{/if}

<style>
	.union {
		cursor: context-menu;
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
