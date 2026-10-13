<script lang="ts">
	import { LAYOUT_METRICS, type TreeLayout } from '#lib/tree-layout/index.js';
	import { fitMinimap, fromMinimap, toMinimap, visibleRect } from './minimap.js';
	import type { ViewTransform } from './view-geometry.js';

	interface Props {
		/** The laid-out tree; only its people and bounds are drawn. */
		layout: TreeLayout;
		/** The canvas transform, so the frame follows every pan and zoom. */
		transform: ViewTransform;
		/** The canvas size in pixels. */
		size: { width: number; height: number };
		/**
		 * Centre the canvas on a layout-space point. `isAnimated` is true for the press that starts a
		 * gesture and false while it drags, so the view tracks the pointer instead of chasing it.
		 */
		onCentre: (x: number, y: number, isAnimated: boolean) => void;
	}

	let { layout, transform, size, onCentre }: Props = $props();

	const MAX_WIDTH_PX = 200;
	const MAX_HEIGHT_PX = 120;

	const frame = $derived(fitMinimap(layout.bounds, MAX_WIDTH_PX, MAX_HEIGHT_PX));
	const view = $derived(toMinimap(frame, visibleRect(transform, size)));
	const cardWidth = $derived(Math.max(1.5, LAYOUT_METRICS.cardWidth * frame.scale));
	const cardHeight = $derived(Math.max(1.5, LAYOUT_METRICS.cardHeight * frame.scale));

	let dragPointer: number | null = null;

	function centreAt(event: PointerEvent, isAnimated: boolean) {
		const box = (event.currentTarget as Element).getBoundingClientRect();
		const point = fromMinimap(frame, event.clientX - box.left, event.clientY - box.top);
		onCentre(point.x, point.y, isAnimated);
	}

	function onPointerDown(event: PointerEvent) {
		if (event.button !== 0) return;
		dragPointer = event.pointerId;
		(event.currentTarget as Element).setPointerCapture?.(event.pointerId);
		centreAt(event, true);
	}

	function onPointerMove(event: PointerEvent) {
		if (event.pointerId !== dragPointer) return;
		// A release can go missing (outside the window, a lost capture); a move with no button held
		// ends the drag rather than letting the view follow a pointer that is only passing over.
		if ((event.buttons & 1) === 0) dragPointer = null;
		else centreAt(event, false);
	}

	function onPointerEnd(event: PointerEvent) {
		if (event.pointerId === dragPointer) dragPointer = null;
	}
</script>

<!--
	Hidden from assistive technology: it repeats what the canvas shows, and the arrow keys, the
	off-screen markers and Fit already move the view without a pointer.
-->
<div
	class="minimap absolute bottom-6 left-6 z-20 overflow-hidden rounded-lg border shadow-md"
	aria-hidden="true"
	data-testid="tree-minimap"
>
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions (pointer-only, hidden above) -->
	<svg
		width={frame.width}
		height={frame.height}
		class="block cursor-pointer touch-none"
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerEnd}
		onpointercancel={onPointerEnd}
		onlostpointercapture={onPointerEnd}
		onclick={(event) => event.stopPropagation()}
	>
		{#each layout.people as person (person.id)}
			<rect
				x={(person.x - frame.originX) * frame.scale - cardWidth / 2}
				y={(person.y - frame.originY) * frame.scale - cardHeight / 2}
				width={cardWidth}
				height={cardHeight}
				rx="1"
				class={person.id === layout.focusPersonId ? 'card focus' : 'card'}
			/>
		{/each}
		<rect
			x={view.x}
			y={view.y}
			width={view.width}
			height={view.height}
			class="view"
			data-testid="tree-minimap-view"
		/>
	</svg>
</div>

<style>
	.minimap {
		background: var(--tree-panel);
		border-color: var(--tree-panel-border);
	}
	.card {
		fill: var(--tree-ink-muted);
		opacity: 0.45;
	}
	.card.focus {
		fill: var(--tree-accent);
		opacity: 1;
	}
	.view {
		fill: var(--tree-accent);
		fill-opacity: 0.12;
		stroke: var(--tree-accent);
		stroke-width: 1.5;
		vector-effect: non-scaling-stroke;
	}
</style>
