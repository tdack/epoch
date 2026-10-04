<script lang="ts">
	import { LAYOUT_METRICS } from '#lib/tree-layout/index.js';
	import { activateOnKey } from './activate-on-key.js';

	interface Props {
		/** The "+N" stub: its id, what it counts and how many. */
		stub: { id: string; kind: 'ancestors' | 'children'; count: number };
		/** Where it stands, in its plane's coordinates. */
		x: number;
		y: number;
		/** The stub was activated; the caller opens it. */
		onExpand: (stubId: string) => void;
	}

	let { stub, x, y, onExpand }: Props = $props();

	const M = LAYOUT_METRICS;
	const noun = $derived(
		stub.kind === 'ancestors'
			? stub.count === 1
				? 'parent'
				: 'ancestors'
			: stub.count === 1
				? 'child'
				: 'children'
	);
</script>

<g
	class="stub"
	data-stub-id={stub.id}
	transform="translate({x}, {y})"
	role="button"
	tabindex="0"
	aria-label="Show {stub.count} more {noun}"
	onclick={(event) => {
		event.stopPropagation();
		onExpand(stub.id);
	}}
	onkeydown={activateOnKey(() => onExpand(stub.id))}
>
	<rect
		x={-M.stubWidth / 2}
		y={-M.stubHeight / 2}
		width={M.stubWidth}
		height={M.stubHeight}
		rx={M.stubHeight / 2}
	/>
	<text text-anchor="middle" y="5">+{stub.count}</text>
</g>

<style>
	.stub {
		cursor: pointer;
		outline: none;
	}
	.stub rect {
		fill: var(--tree-panel);
		stroke: var(--tree-ink-muted);
		stroke-width: 1.5;
	}
	.stub text {
		fill: var(--tree-ink);
		font-size: 13px;
		font-weight: 700;
	}
	.stub:hover rect,
	.stub:focus-visible rect {
		stroke: var(--tree-focus-ring);
		stroke-width: 3;
	}
</style>
