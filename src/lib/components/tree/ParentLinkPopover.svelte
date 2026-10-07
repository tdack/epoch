<script lang="ts">
	import { onMount } from 'svelte';
	import type { ChildAssertion, ChildEdge } from '#lib/tree-layout/index.js';
	import type { ParentChildType } from '#lib/shared/relationship-model.js';
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
		/** Remove exactly one parent's link; the others on the edge stay. Absent for a read-only role. */
		onRemove?: (edge: ChildEdge, assertion: ChildAssertion) => void;
		/** Ask to change one parent's link to another type; the caller previews it and confirms. */
		onChangeType?: (edge: ChildEdge, assertion: ChildAssertion, toType: ParentChildType) => void;
		/** Escape or the Close button. */
		onClose: () => void;
	}

	let { edge, childName, nameOf, x, y, onRemove, onChangeType, onClose }: Props = $props();

	const TYPES = Object.keys(RELATIONSHIP_STYLES) as ParentChildType[];

	let dialogElement: HTMLDivElement | null = $state(null);

	onMount(() => {
		dialogElement?.querySelector<HTMLButtonElement>('button')?.focus();
	});

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.stopPropagation();
			onClose();
			return;
		}
		if (event.key !== 'Tab') return;
		// Focus is trapped while the popover is open: Tab and Shift+Tab wrap between its buttons.
		const buttons = [...(dialogElement?.querySelectorAll<HTMLElement>('button, select') ?? [])];
		if (buttons.length === 0) return;
		const first = buttons[0];
		const last = buttons[buttons.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}
</script>

<div
	bind:this={dialogElement}
	class="popover"
	style="left: {x}px; top: {y}px;"
	role="dialog"
	aria-modal="true"
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
				{#if onChangeType}<select
						class="change"
						aria-label="Change {style.label.toLowerCase()} link from {nameOf(
							assertion.parentId
						)} to…"
						onchange={(event) => {
							const toType = event.currentTarget.value as ParentChildType;
							event.currentTarget.value = '';
							if (toType) onChangeType?.(edge, assertion, toType);
						}}
					>
						<option value="">Change…</option>
						{#each TYPES.filter((t) => t !== assertion.type) as t (t)}
							<option value={t}>{RELATIONSHIP_STYLES[t].label}</option>
						{/each}
					</select>{/if}
				{#if onRemove}<button
						type="button"
						class="remove"
						aria-label="Remove {style.label.toLowerCase()} link from {nameOf(assertion.parentId)}…"
						onclick={() => onRemove?.(edge, assertion)}
					>
						Remove
					</button>{/if}
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
		border-radius: 12px;
		box-shadow: var(--shadow-md);
		font-size: 0.875rem;
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
		border-top: 1px solid var(--color-stone-200);
	}
	.who {
		flex: 1;
		min-width: 0;
	}
	.type {
		display: block;
		font-size: 0.75rem;
		color: var(--tree-ink-muted);
	}
	select {
		max-width: 6.5rem;
		border-radius: 6px;
		padding: 3px 4px;
		border: 1px solid var(--tree-panel-border);
		background: white;
		font-size: 0.75rem;
	}
	button {
		cursor: pointer;
		font-size: 0.75rem;
		font-weight: 600;
		border-radius: 6px;
		padding: 3px 8px;
		border: 1px solid var(--tree-panel-border);
	}
	.remove {
		color: var(--color-red-700);
		border-color: var(--color-red-200);
	}
	.remove:hover,
	.close:hover {
		background: var(--color-stone-100);
	}
	button:focus-visible {
		outline: 2px solid var(--tree-focus-ring);
		outline-offset: 1px;
	}
</style>
