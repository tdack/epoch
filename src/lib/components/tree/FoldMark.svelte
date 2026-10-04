<script lang="ts">
	import { LAYOUT_METRICS } from '#lib/tree-layout/index.js';
	import { activateOnKey } from './activate-on-key.js';

	interface Props {
		/** The folded run: its id and how many cards it stands in for. */
		mark: { id: string; count: number };
		/** Where it stands, in its plane's coordinates. */
		x: number;
		y: number;
		/** What the row is called, read out with the count ("sibling line"). */
		rowName: string;
		/** The mark was activated; the caller unfolds the row. */
		onOpen: (markId: string) => void;
	}

	let { mark, x, y, rowName, onOpen }: Props = $props();

	const M = LAYOUT_METRICS;
</script>

<g
	class="fold"
	data-fold-id={mark.id}
	transform="translate({x}, {y})"
	role="button"
	tabindex="0"
	aria-label="Show {mark.count} more {mark.count === 1 ? 'person' : 'people'} on the {rowName}"
	onclick={(event) => {
		event.stopPropagation();
		onOpen(mark.id);
	}}
	onkeydown={activateOnKey(() => onOpen(mark.id))}
>
	<rect
		x={-M.cardWidth / 2}
		y={-M.cardHeight / 2}
		width={M.cardWidth}
		height={M.cardHeight}
		rx="10"
	/>
	<text text-anchor="middle" y="6">+{mark.count} more</text>
</g>

<style>
	.fold {
		cursor: pointer;
		outline: none;
	}
	.fold rect {
		fill: var(--tree-panel);
		stroke: var(--tree-ink-muted);
		stroke-width: 1.5;
		stroke-dasharray: 2 5;
		stroke-linecap: round;
	}
	.fold text {
		fill: var(--tree-ink);
		font-size: 15px;
		font-weight: 700;
	}
	.fold:hover rect,
	.fold:focus-visible rect {
		stroke: var(--tree-focus-ring);
		stroke-width: 3;
	}
</style>
