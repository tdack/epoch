<script lang="ts">
	import type { DiveTarget, TrailEntry } from './dive.js';

	interface Props {
		/** The families one generation back, each a way to dive; drawn above the current one. */
		earlier: DiveTarget[];
		/** The family the chart is centred on. */
		current: TrailEntry | null;
		/** The families dived out of, nearest first; drawn below the current one. */
		later: TrailEntry[];
		/** Names the person each earlier family is the parents of. */
		nameOf: (personId: string) => string;
		/** Dive to one of `earlier`. */
		onBack: (target: DiveTarget) => void;
		/** Surface to `later[index]`, passing every family between. */
		onForward: (index: number) => void;
		/** A move is under way; the buttons wait for it. */
		isTravelling?: boolean;
	}

	let {
		earlier,
		current,
		later,
		nameOf,
		onBack,
		onForward,
		isTravelling = false
	}: Props = $props();

	const forwardNote = (index: number) =>
		index === 0 ? 'One generation forward' : `${index + 1} generations forward`;
</script>

<details class="rail" open>
	<summary class="focus-ring">Generations</summary>
	<ol class="steps" aria-label="Generations, earliest first">
		{#each earlier as target, i (target.unionId ?? target.focusId)}
			<li class="step earlier">
				<span class="node" aria-hidden="true"></span>
				<button
					type="button"
					class="move"
					disabled={isTravelling}
					aria-keyshortcuts={i === 0 ? 'PageUp' : undefined}
					onclick={() => onBack(target)}
				>
					<span class="name">{target.label}</span>
					<span class="note">Parents of {nameOf(target.childId)}</span>
				</button>
			</li>
		{/each}
		{#if current}
			<li class="step here" aria-current="step">
				<span class="node" aria-hidden="true"></span>
				<span class="move">
					<span class="name">{current.label}</span>
					<span class="note">Centred here</span>
				</span>
			</li>
		{/if}
		{#each later as entry, i (entry.focusId)}
			<li class="step later">
				<span class="node" aria-hidden="true"></span>
				<button
					type="button"
					class="move"
					disabled={isTravelling}
					aria-keyshortcuts={i === 0 ? 'PageDown' : undefined}
					onclick={() => onForward(i)}
				>
					<span class="name">{entry.label}</span>
					<span class="note">{forwardNote(i)}</span>
				</button>
			</li>
		{/each}
	</ol>
	{#if earlier.length > 0}
		<p class="tip">Keep zooming in to go back a generation.</p>
	{/if}
</details>

<style>
	.rail {
		width: 15rem;
		max-width: calc(100vw - 2rem);
		background: color-mix(in srgb, var(--tree-panel) 96%, transparent);
		border: 1px solid var(--tree-panel-border);
		border-radius: 12px;
		padding: 8px 12px;
		font-size: 0.75rem;
		color: var(--tree-ink);
		box-shadow: var(--shadow-md);
	}
	summary {
		cursor: pointer;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--tree-ink-muted);
	}
	.steps {
		position: relative;
		margin: 8px 0 0;
		padding: 0;
		list-style: none;
	}
	/* The gauge: one rule the generations hang on, oldest at the top as they stand behind. */
	.steps::before {
		content: '';
		position: absolute;
		left: 5px;
		top: 12px;
		bottom: 12px;
		width: 1px;
		background: var(--tree-panel-border);
	}
	.step {
		position: relative;
		display: flex;
		align-items: flex-start;
		gap: 10px;
	}
	.node {
		position: relative;
		flex: none;
		width: 11px;
		height: 11px;
		margin-top: 9px;
		border-radius: 9999px;
		background: var(--tree-panel);
		border: 1.5px solid var(--tree-ink-muted);
	}
	.earlier .node {
		border-style: dashed;
		border-color: var(--union-ink);
	}
	.here .node {
		background: var(--color-emerald-800);
		border-color: var(--color-emerald-800);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-emerald-800) 22%, transparent);
	}
	.move {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-direction: column;
		padding: 4px 6px;
		margin-left: -6px;
		border-radius: 8px;
		text-align: left;
	}
	button.move {
		cursor: pointer;
	}
	button.move:hover:not(:disabled) {
		background: rgb(231 229 228 / 0.6);
	}
	button.move:disabled {
		cursor: progress;
	}
	button.move:focus-visible {
		outline: 2px solid var(--tree-focus-ring);
		outline-offset: 1px;
	}
	.name {
		overflow: hidden;
		font-weight: 600;
		line-height: 1.35;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.here .name {
		color: var(--color-emerald-900);
		font-weight: 700;
	}
	.note {
		overflow: hidden;
		color: var(--tree-ink-muted);
		line-height: 1.35;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.earlier .note {
		color: var(--union-ink);
	}
	.tip {
		margin: 6px 0 0;
		padding-top: 6px;
		border-top: 1px solid var(--tree-panel-border);
		color: var(--tree-ink-muted);
		line-height: 1.4;
	}
	/* A phone keeps the names and drops the explanations, so the gauge does not cover the chart. */
	@media (max-width: 639px) {
		.rail {
			width: 11rem;
		}
		.note,
		.tip {
			display: none;
		}
	}
	/* A pinch never dives, so a touch screen is not told to keep zooming; the rail is the way. */
	@media (pointer: coarse) {
		.tip {
			display: none;
		}
		.move {
			min-height: 2.75rem;
			justify-content: center;
		}
		.node {
			margin-top: 16px;
		}
	}
</style>
