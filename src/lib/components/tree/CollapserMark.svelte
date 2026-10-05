<script lang="ts">
	import { activateOnKey } from './activate-on-key.js';

	interface Props {
		/** Id of the stub this control folds back up. */
		stubId: string;
		/** Where it stands, in its plane's coordinates. */
		x: number;
		y: number;
		/** The control was activated; the caller removes the stub from the expanded set. */
		onCollapse: (stubId: string) => void;
	}

	let { stubId, x, y, onCollapse }: Props = $props();
</script>

<g
	class="collapser"
	data-collapser-id={stubId}
	transform="translate({x}, {y})"
	role="button"
	tabindex="0"
	aria-label="Collapse this branch"
	onclick={(event) => {
		event.stopPropagation();
		onCollapse(stubId);
	}}
	onkeydown={activateOnKey(() => onCollapse(stubId))}
>
	<circle r="10" />
	<line x1="-5" y1="0" x2="5" y2="0" />
</g>

<style>
	.collapser {
		cursor: pointer;
		outline: none;
	}
	.collapser circle {
		fill: var(--tree-panel);
		stroke: var(--tree-ink-muted);
		stroke-width: 1.5;
	}
	.collapser line {
		stroke: var(--tree-ink);
		stroke-width: 2;
		stroke-linecap: round;
	}
	.collapser:hover circle,
	.collapser:focus-visible circle {
		stroke: var(--tree-focus-ring);
		stroke-width: 3;
	}
</style>
