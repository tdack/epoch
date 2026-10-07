<script lang="ts" module>
	import type { StagePoint } from './plane-stack.js';

	export interface PlaneSpec {
		key: string;
		/** Offset toward the viewer before the camera tilts the stage. */
		z: number;
		/** Where the plane stands across and down in the stage; the origin when absent. */
		offset?: { x: number; y: number };
		/** The plane's drawn extent, in its own coordinates. */
		bounds: { minX: number; maxX: number; minY: number; maxY: number };
		/** Name of the plane, read out for the group and drawn in its corner. */
		label: string;
	}

	export interface ConnectorSpec {
		id: string;
		from: StagePoint;
		to: StagePoint;
		/** CSS custom property holding the line colour. */
		colorVar: string;
		lineStyle: 'solid' | 'dashed' | 'dotted';
		opacity?: number;
	}
</script>

<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import {
		CONNECTOR_WIDTH_PX,
		PERSPECTIVE_PX,
		cameraTransform,
		connectorStyle,
		type CameraPresetName
	} from './plane-stack.js';

	interface Props {
		/** The planes, each drawn with `plane`. */
		planes: PlaneSpec[];
		/** Lines that cross from one plane to another. They are not interactive. */
		connectors: ConnectorSpec[];
		/** Which fixed camera to look through. */
		camera: CameraPresetName;
		/** Pan and zoom, from `TreeViewport`; the same maths as the flat canvas. */
		transform: { x: number; y: number; k: number };
		/**
		 * Changes when the chart is redrawn around someone else. The planes then settle in with a short
		 * fade; the first draw and a viewer who prefers reduced motion get none.
		 */
		settleKey?: string;
		/** False while the caller animates the change itself, so the two motions do not stack. */
		shouldSettle?: boolean;
		/** The content of one plane: SVG elements in the plane's own coordinates. */
		plane: Snippet<[PlaneSpec]>;
	}

	let {
		planes,
		connectors,
		camera,
		transform,
		settleKey,
		shouldSettle = true,
		plane
	}: Props = $props();

	const SETTLE_MS = 320;
	let rootElement: HTMLDivElement | null = $state(null);
	let lastSettleKey: string | undefined;

	// Cards sit in per-plane SVGs, so one that changes plane is a new element and cannot slide from
	// one to the other; a fade of everything keeps the change from reading as a jump instead.
	$effect(() => {
		const key = settleKey;
		untrack(() => {
			const isFirst = lastSettleKey === undefined;
			lastSettleKey = key;
			if (isFirst || !shouldSettle || !rootElement || typeof matchMedia !== 'function') return;
			if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
			for (const el of rootElement.querySelectorAll('.content, .connector')) {
				el.animate([{ opacity: 0.25 }, { opacity: 1 }], {
					duration: SETTLE_MS,
					easing: 'ease-out'
				});
			}
		});
	});

	const connectorStyles = $derived(
		connectors.map((c) => ({ spec: c, style: connectorStyle(c.from, c.to) }))
	);
</script>

<!--
	Zoom is CSS `zoom` on this wrapper, never scale(): scale() rasterises the planes once and
	stretches them, so text goes soft, while zoom lays them out again at the new size (ADR-030).
	The pan is a translate in zoomed units, hence the division by k.
-->
<div
	bind:this={rootElement}
	class="pan"
	style:zoom={transform.k}
	style:transform="translate({transform.x / transform.k}px, {transform.y / transform.k}px)"
>
	<div class="perspective" style:perspective="{PERSPECTIVE_PX}px">
		<div class="stage" style:transform={cameraTransform(camera)}>
			{#each planes as spec (spec.key)}
				<div
					class="plane"
					data-plane-key={spec.key}
					style:transform="translate3d({spec.offset?.x ?? 0}px, {spec.offset?.y ?? 0}px, {spec.z}px)"
				>
					<div
						class="sheet"
						style:left="{spec.bounds.minX}px"
						style:top="{spec.bounds.minY}px"
						style:width="{spec.bounds.maxX - spec.bounds.minX}px"
						style:height="{spec.bounds.maxY - spec.bounds.minY}px"
					>
						<span class="label" aria-hidden="true">{spec.label}</span>
					</div>
					<svg class="content" width="1" height="1" role="group" aria-label={spec.label}>
						{@render plane(spec)}
					</svg>
				</div>
			{/each}

			{#each connectorStyles as { spec, style } (spec.id)}
				<div
					class="connector"
					aria-hidden="true"
					style:height="{style.length}px"
					style:transform={style.transform}
					style:border-left="{CONNECTOR_WIDTH_PX}px {spec.lineStyle} var({spec.colorVar})"
					style:opacity={spec.opacity}
				></div>
			{/each}
		</div>
	</div>
</div>

<style>
	.pan {
		position: absolute;
		left: 0;
		top: 0;
		width: 0;
		height: 0;
		transform-origin: 0 0;
	}
	.perspective {
		position: absolute;
		left: 0;
		top: 0;
		width: 0;
		height: 0;
	}
	.stage {
		position: absolute;
		left: 0;
		top: 0;
		width: 0;
		height: 0;
		transform-style: preserve-3d;
	}
	/* A plane catches nothing, so one in front never swallows a click meant for a card behind it. */
	.plane {
		position: absolute;
		left: 0;
		top: 0;
		width: 0;
		height: 0;
		transform-style: preserve-3d;
		pointer-events: none;
	}
	.sheet {
		position: absolute;
		border: 1px dashed var(--tree-panel-border);
		border-radius: 12px;
		background: rgb(253 251 247 / 0.55);
	}
	.label {
		position: absolute;
		left: 12px;
		top: 8px;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--tree-ink-muted);
	}
	.content {
		position: absolute;
		left: 0;
		top: 0;
		overflow: visible;
	}
	.connector {
		position: absolute;
		left: 0;
		top: 0;
		width: 0;
		transform-origin: 0 0;
		pointer-events: none;
	}
	.stage :global([data-person-id]),
	.stage :global([data-union-id]),
	.stage :global([data-ghost-id]),
	.stage :global([data-stub-id]),
	.stage :global([data-fold-id]),
	.stage :global([data-collapser-id]) {
		pointer-events: auto;
	}
</style>
