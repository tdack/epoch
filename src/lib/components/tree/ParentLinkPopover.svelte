<script lang="ts">
	import { onMount } from 'svelte';
	import type { ChildAssertion, ChildEdge } from '#lib/tree-layout/index.js';
	import { RELATIONSHIP_STYLES } from './tree-view.js';

	interface Props {
		/** The merged (union, child) edge whose per-parent links are listed. */
		edge: ChildEdge;
		childName: string;
		/** Display name for a parent id; the id itself when the parent is not drawn. */
		nameOf: (personId: string) => string;
		/** Position in pixels inside the canvas container. */
		x: number;
		y: number;
		onRemove: (edge: ChildEdge, assertion: ChildAssertion) => void;
		onClose: () => void;
	}

	let { edge, childName, nameOf, x, y, onRemove, onClose }: Props = $props();

	let dialogElement: HTMLDivElement | null = $state(null);

	onMount(() => {
		dialogElement?.querySelector<HTMLButtonElement>('button')?.focus();
	});

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.stopPropagation();
			onClose();
		}
	}
</script>

<div
	bind:this={dialogElement}
	class="popover"
	style="left: {x}px; top: {y}px;"
	role="dialog"
	aria-label="Parent links to {childName}"
	tabindex="-1"
	onkeydown={onKeydown}
>
	<p class="title">Parent links to {childName}</p>
	<ul>
		{#each edge.assertions as assertion (`${assertion.parentId}|${assertion.type}`)}
			{@const style = RELATIONSHIP_STYLES[assertion.type]}
			<li>
				<svg width="30" height="8" aria-hidden="true">
					<line
						x1="2"
						y1="4"
						x2="28"
						y2="4"
						stroke={`var(${style.colorVar})`}
						stroke-width="2"
						stroke-dasharray={style.dash ?? undefined}
						stroke-linecap={style.isRound ? 'round' : undefined}
					/>
				</svg>
				<span class="who">
					{nameOf(assertion.parentId)}
					<span class="type">{style.label}</span>
				</span>
				<button
					type="button"
					class="remove"
					aria-label="Remove {style.label.toLowerCase()} link from {nameOf(assertion.parentId)}"
					onclick={() => onRemove(edge, assertion)}
				>
					Remove
				</button>
			</li>
		{/each}
	</ul>
	<button type="button" class="close" onclick={onClose}>Close</button>
</div>

<style>
	.popover {
		position: absolute;
		z-index: 30;
		width: 20rem;
		max-width: calc(100% - 16px);
		padding: 10px 12px;
		background: white;
		border: 1px solid var(--tree-panel-border);
		border-radius: 10px;
		box-shadow: 0 6px 18px rgb(0 0 0 / 0.2);
		font-size: 13px;
		color: var(--tree-ink);
	}
	.title {
		font-weight: 700;
		margin-bottom: 6px;
	}
	ul {
		list-style: none;
		padding: 0;
		margin: 0 0 8px;
	}
	li {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 0;
		border-top: 1px solid #f0efed;
	}
	.who {
		flex: 1;
		min-width: 0;
	}
	.type {
		display: block;
		font-size: 11px;
		color: var(--tree-ink-muted);
	}
	button {
		cursor: pointer;
		border-radius: 6px;
		padding: 3px 8px;
		border: 1px solid var(--tree-panel-border);
	}
	.remove {
		color: #b91c1c;
		border-color: #fecaca;
	}
	.remove:hover,
	.close:hover {
		background: #f5f5f4;
	}
	button:focus-visible {
		outline: 2px solid var(--tree-focus-ring);
		outline-offset: 1px;
	}
</style>
