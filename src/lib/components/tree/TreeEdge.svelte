<script lang="ts">
	import type { LayoutEdge, PlacedStub } from '#lib/tree-layout/index.js';
	import {
		childEdgePath,
		childEdgeStyle,
		partnerEdgePath,
		stubEdgePath
	} from './tree-view.js';

	interface Props {
		/** The edge to draw; child edges are styled by their parents' relationship types. */
		edge: LayoutEdge;
		/** The stub a stub edge leads to. */
		stub?: PlacedStub;
		/** True when a stub edge starts at a union node rather than at a card. */
		isFromUnion?: boolean;
		/** True when the union a partner edge belongs to has ended (separated, divorced, ...). */
		isUnionEnded?: boolean;
		/** True while the edge is the selected one; drawn thicker with a halo. */
		isSelected?: boolean;
		/** Click on the edge's hit target. */
		onSelect?: (edge: LayoutEdge, event: MouseEvent) => void;
		/** Right-click on the edge; the handler is responsible for `preventDefault`. */
		onContextMenu?: (edge: LayoutEdge, event: MouseEvent) => void;
	}

	let {
		edge,
		stub,
		isFromUnion = false,
		isUnionEnded = false,
		isSelected = false,
		onSelect,
		onContextMenu
	}: Props = $props();

	const style = $derived(edge.kind === 'child' ? childEdgeStyle(edge.types) : null);
	const d = $derived(
		edge.kind === 'child'
			? childEdgePath(edge)
			: edge.kind === 'partner'
				? partnerEdgePath(edge)
				: stub
					? stubEdgePath(edge, stub, isFromUnion)
					: ''
	);
	const title = $derived(
		edge.kind === 'child'
			? `${style!.label}${edge.isSecondaryPath ? ' (also reached another way)' : ''}${edge.assertions.length > 1 ? ` · ${edge.assertions.length} parent links` : ''}`
			: edge.kind === 'partner'
				? isUnionEnded
					? 'Ended partnership'
					: 'Partnership'
				: ''
	);
</script>

{#if edge.kind === 'stub'}
	<path class="stub-line" {d} />
{:else}
	{#if isSelected}
		<path class="halo" {d} />
	{/if}
	<path
		class="line"
		class:partner={edge.kind === 'partner'}
		class:ended={edge.kind === 'partner' && isUnionEnded}
		class:secondary={edge.kind === 'child' && edge.isSecondaryPath}
		class:selected={isSelected}
		{d}
		style:stroke={style ? `var(${style.colorVar})` : undefined}
		style:stroke-dasharray={style?.dash ?? undefined}
		style:stroke-linecap={style?.isRound ? 'round' : undefined}
	/>
	<path
		class="target"
		data-edge-id={edge.id}
		{d}
		role="button"
		tabindex="-1"
		aria-label={title}
		onclick={(event) => onSelect?.(edge, event)}
		oncontextmenu={(event) => onContextMenu?.(edge, event)}
		onkeydown={(event) => {
			if (event.key === 'Enter') onSelect?.(edge, event as unknown as MouseEvent);
		}}
	>
		<title>{title}</title>
	</path>
{/if}

<style>
	path {
		fill: none;
		vector-effect: non-scaling-stroke;
	}
	.line {
		stroke-width: 2;
		pointer-events: none;
	}
	.line.partner {
		stroke: var(--partner-line);
		stroke-width: 2.25;
	}
	.line.ended {
		stroke-dasharray: 7 5;
	}
	.line.secondary {
		stroke-opacity: 0.6;
		stroke-width: 1.5;
	}
	.line.selected {
		stroke-width: 3.5;
	}
	.halo {
		stroke: var(--tree-focus-ring);
		stroke-opacity: 0.18;
		stroke-width: 10;
		pointer-events: none;
	}
	.target {
		stroke: transparent;
		stroke-width: 14;
		pointer-events: stroke;
		cursor: pointer;
	}
	.stub-line {
		stroke: var(--rel-unknown);
		stroke-width: 1.5;
		stroke-dasharray: 3 4;
		pointer-events: none;
	}
</style>
