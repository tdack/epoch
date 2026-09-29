<script lang="ts">
	import { onMount } from 'svelte';
	import type { MenuItem } from './tree-view.js';

	interface Props {
		/** Menu entries, top to bottom. */
		items: MenuItem[];
		/** Position in pixels inside the canvas container. */
		x: number;
		y: number;
		/** Called after an item ran, on Escape, and when focus leaves the menu. */
		onClose: () => void;
	}

	let { items, x, y, onClose }: Props = $props();

	let menuElement: HTMLDivElement | null = $state(null);

	onMount(() => {
		menuElement?.querySelector<HTMLButtonElement>('button')?.focus();
	});

	function run(item: MenuItem) {
		onClose();
		item.onClick();
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.stopPropagation();
			onClose();
			return;
		}
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
		event.preventDefault();
		const buttons = [...(menuElement?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
		const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
		const next = event.key === 'ArrowDown' ? at + 1 : at - 1;
		buttons[(next + buttons.length) % buttons.length]?.focus();
	}
</script>

<div
	bind:this={menuElement}
	class="menu"
	style="left: {x}px; top: {y}px;"
	role="menu"
	tabindex="-1"
	onkeydown={onKeydown}
	onfocusout={(event) => {
		if (!menuElement?.contains(event.relatedTarget as Node | null)) onClose();
	}}
>
	{#each items as item (item.label)}
		<button type="button" role="menuitem" class:danger={item.isDanger} onclick={() => run(item)}>
			{item.label}
		</button>
	{/each}
</div>

<style>
	.menu {
		position: absolute;
		z-index: 30;
		min-width: 11rem;
		padding: 4px 0;
		background: white;
		border: 1px solid var(--tree-panel-border);
		border-radius: 8px;
		box-shadow: 0 6px 18px rgb(0 0 0 / 0.18);
		font-size: 14px;
	}
	button {
		display: block;
		width: 100%;
		padding: 6px 12px;
		text-align: left;
		color: var(--tree-ink);
		cursor: pointer;
	}
	button:hover,
	button:focus-visible {
		background: #f5f5f4;
		outline: none;
	}
	button.danger {
		color: #b91c1c;
	}
</style>
