<script lang="ts">
	import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from '@lucide/svelte';
	import {
		EDGE_DIRECTIONS,
		markerLabel,
		type EdgeDirection,
		type OffscreenMarker
	} from './view-geometry.js';

	interface Props {
		/** One marker per edge that has people beyond it; none when everyone shows. */
		markers: OffscreenMarker[];
		/** A marker was activated: pan toward the people it counts. */
		onPan: (marker: OffscreenMarker) => void;
	}

	let { markers, onPan }: Props = $props();

	const ICONS = {
		[EDGE_DIRECTIONS.LEFT]: ChevronLeft,
		[EDGE_DIRECTIONS.RIGHT]: ChevronRight,
		[EDGE_DIRECTIONS.UP]: ChevronUp,
		[EDGE_DIRECTIONS.DOWN]: ChevronDown
	};
	/**
	 * Pinned to the middle of each edge. The bottom one sits left of centre on a phone because the
	 * zoom bar takes the bottom-right corner there and would cover a centred one.
	 */
	const PLACEMENT: Record<EdgeDirection, string> = {
		left: 'top-1/2 left-1.5 -translate-y-1/2',
		right: 'top-1/2 right-1.5 -translate-y-1/2',
		up: 'top-1.5 left-1/2 -translate-x-1/2',
		down: 'bottom-6 left-3 sm:bottom-1.5 sm:left-1/2 sm:-translate-x-1/2'
	};

	function countText(count: number): string {
		return count > 99 ? '99+' : String(count);
	}
</script>

{#each markers as marker (marker.direction)}
	{@const Icon = ICONS[marker.direction]}
	<button
		type="button"
		class="marker absolute z-20 inline-flex min-h-7 cursor-pointer items-center justify-center gap-0.5 rounded-full border border-stone-300 px-1.5 text-xs font-semibold text-stone-700 tabular-nums shadow-md focus-ring hover:bg-stone-100 coarse:min-h-11 coarse:min-w-11 {PLACEMENT[
			marker.direction
		]}"
		aria-label={markerLabel(marker)}
		title={markerLabel(marker)}
		onclick={() => onPan(marker)}
	>
		<Icon class="h-4 w-4 text-emerald-800" aria-hidden="true" />
		<span aria-hidden="true">{countText(marker.count)}</span>
	</button>
{/each}

<style>
	.marker {
		background: var(--tree-panel);
	}
</style>
