<script lang="ts">
	import { Maximize2, ZoomIn, ZoomOut } from 'lucide-svelte';

	interface Props {
		/** Current zoom scale, shown as a percentage. */
		scale: number;
		onZoomIn: () => void;
		onZoomOut: () => void;
		onFit: () => void;
		/**
		 * Where the bar sits. The default pins it to the bottom-right corner; a canvas with its own
		 * bottom controls passes a flow position instead so the two cannot overlap on a phone.
		 */
		class?: string;
	}

	let {
		scale,
		onZoomIn,
		onZoomOut,
		onFit,
		class: placement = 'absolute right-6 bottom-6'
	}: Props = $props();
</script>

<div
	class="{placement} z-20 flex items-center gap-1.5 rounded-xl border border-stone-300 p-1.5 shadow-md"
	style="background: var(--tree-panel);"
>
	<button type="button" title="Zoom in" aria-label="Zoom in" onclick={onZoomIn} class="control">
		<ZoomIn class="h-4 w-4" />
	</button>
	<button type="button" title="Zoom out" aria-label="Zoom out" onclick={onZoomOut} class="control">
		<ZoomOut class="h-4 w-4" />
	</button>
	<button
		type="button"
		title="Fit to view"
		aria-label="Fit to view"
		onclick={onFit}
		class="control"
	>
		<Maximize2 class="h-4 w-4" />
	</button>
	<span class="px-1 text-xs text-stone-600 tabular-nums" aria-live="off"
		>{Math.round(scale * 100)}%</span
	>
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
</style>
