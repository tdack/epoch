<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		isOpen: boolean;
		title: string;
		icon?: any;
		iconBgClass?: string;
		iconBorderClass?: string;
		iconTextClass?: string;
		maxWidthClass?: string;
		error?: string | null;
		subtitle?: string | null;
		onclose: () => void;
		children: Snippet;
		headerExtra?: Snippet;
	}

	let {
		isOpen,
		title,
		icon: IconComponent,
		iconBgClass = 'bg-emerald-100',
		iconBorderClass = 'border-emerald-300',
		iconTextClass = 'text-emerald-800',
		maxWidthClass = 'max-w-md',
		error = null,
		subtitle = null,
		onclose,
		children,
		headerExtra
	}: Props = $props();

	const titleId = `modal-title-${Math.random().toString(36).slice(2, 9)}`;
	let dialogElement: HTMLDialogElement | null = $state(null);

	// The native dialog traps focus, makes the page behind inert and hands focus back to whatever
	// opened it when it closes, which a div overlay would each need reimplementing.
	$effect(() => {
		if (!dialogElement) return;
		if (isOpen && !dialogElement.open) dialogElement.showModal();
		else if (!isOpen && dialogElement.open) dialogElement.close();
	});

	function onCancel(event: Event) {
		// Escape: let the owner decide, so `isOpen` stays the single source of truth.
		event.preventDefault();
		onclose();
	}
</script>

<dialog
	bind:this={dialogElement}
	aria-labelledby={titleId}
	oncancel={onCancel}
	class="m-auto w-full {maxWidthClass} max-h-[90vh] overflow-y-auto rounded-2xl border border-stone-300/90 bg-[#fcfaf5] p-0 text-stone-800 shadow-2xl backdrop:bg-stone-950/40 backdrop:backdrop-blur-xs"
>
	{#if isOpen}
		<div class="space-y-4 p-6">
			<div class="flex items-center space-x-2.5">
				{#if IconComponent}
					<div
						class="h-7 w-7 rounded-lg {iconBgClass} border {iconBorderClass} flex items-center justify-center {iconTextClass} shrink-0"
					>
						<IconComponent class="h-4 w-4" />
					</div>
				{/if}
				<div class="min-w-0 flex-1">
					<h3 id={titleId} class="truncate text-lg font-bold text-stone-900">{title}</h3>
					{#if subtitle}
						<p class="text-[11px] text-stone-500">{subtitle}</p>
					{/if}
				</div>
				{#if headerExtra}
					{@render headerExtra()}
				{/if}
			</div>

			{#if error}
				<div
					role="alert"
					class="rounded-lg border border-orange-300 bg-orange-50 p-2.5 text-xs font-medium text-orange-900"
				>
					{error}
				</div>
			{/if}

			{@render children()}
		</div>
	{/if}
</dialog>
