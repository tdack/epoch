<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import { Info } from '@lucide/svelte';

	interface Props {
		/** Prefix for the button (`{id}-help-button`) and panel (`{id}-help`) ids. */
		id: string;
		/** The button's accessible name, e.g. "Date formats". */
		label: string;
		/** Classes for the wrapper, so the caller can place the (i) inside or beside its field. */
		class?: string;
		/** The help itself. */
		children: Snippet;
	}

	let { id, label, class: className = '', children }: Props = $props();

	const HELP_WIDTH_PX = 288;
	const VIEWPORT_MARGIN_PX = 8;

	let isHelpOpen = $state(false);
	let wrapper: HTMLSpanElement | undefined = $state();
	let helpButton: HTMLButtonElement | undefined = $state();
	let helpPanel: HTMLDivElement | undefined = $state();
	/** Fixed rather than absolute: a dialog scrolls its own content and would cut it off at its edge. */
	let helpPosition = $state({ left: 0, top: 0 });
	let helpCloseTimer: ReturnType<typeof setTimeout> | undefined;

	async function showHelp() {
		clearTimeout(helpCloseTimer);
		if (isHelpOpen) return;
		isHelpOpen = true;
		await tick();
		if (!helpButton || !helpPanel) return;
		const rect = helpButton.getBoundingClientRect();
		const height = helpPanel.offsetHeight;
		const left = Math.min(
			Math.max(rect.left + rect.width / 2 - HELP_WIDTH_PX / 2, VIEWPORT_MARGIN_PX),
			window.innerWidth - HELP_WIDTH_PX - VIEWPORT_MARGIN_PX
		);
		// Above the field by default, so it never covers what is typed or the message under it.
		const above = rect.top - height - 6;
		const top = above >= VIEWPORT_MARGIN_PX ? above : rect.bottom + 6;
		helpPosition = { left, top };
	}

	/**
	 * Closing waits a moment so the pointer can cross from the icon onto the help, which stays open
	 * while hovered and can then be read or copied from.
	 */
	function hideHelpSoon() {
		clearTimeout(helpCloseTimer);
		helpCloseTimer = setTimeout(() => (isHelpOpen = false), 150);
	}

	// Tabbing from the icon into a link in the help must not close it under the keyboard.
	function onFocusOut(event: FocusEvent) {
		if (!wrapper?.contains(event.relatedTarget as Node | null)) hideHelpSoon();
	}

	function onHelpKeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || !isHelpOpen) return;
		// Close only the help; the dialog around it would otherwise treat Escape as "cancel".
		event.preventDefault();
		event.stopPropagation();
		isHelpOpen = false;
	}
</script>

<span
	bind:this={wrapper}
	class={className}
	role="presentation"
	onpointerenter={showHelp}
	onpointerleave={hideHelpSoon}
	onfocusout={onFocusOut}
	onkeydown={onHelpKeydown}
>
	<button
		bind:this={helpButton}
		id="{id}-help-button"
		type="button"
		aria-label={label}
		aria-describedby={isHelpOpen ? `${id}-help` : undefined}
		onfocus={showHelp}
		onclick={showHelp}
		class="cursor-help rounded-full p-0.5 text-stone-400 hover:text-emerald-700 focus-visible:text-emerald-700 focus-visible:outline-2 focus-visible:outline-emerald-600"
	>
		<Info size={14} aria-hidden="true" />
	</button>
	{#if isHelpOpen}
		<div
			bind:this={helpPanel}
			id="{id}-help"
			role="tooltip"
			style="left: {helpPosition.left}px; top: {helpPosition.top}px; width: {HELP_WIDTH_PX}px;"
			class="fixed z-30 rounded-lg border border-stone-300 bg-white p-3 text-left text-[11px] font-normal text-stone-700 shadow-xl"
		>
			{@render children()}
		</div>
	{/if}
</span>
