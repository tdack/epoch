<script lang="ts">
	import { X } from 'lucide-svelte';
	import { TOAST_TONES, type Toast } from './toasts.svelte.js';

	interface Props {
		/** The message to show. */
		toast: Toast;
		/** Called when it times out or is dismissed. */
		onDismiss: () => void;
	}

	let { toast, onDismiss }: Props = $props();

	let isPaused = $state(false);
	let isRunning = $state(false);

	// Hovering or focusing the toast holds it open so an action can be reached; leaving restarts the clock.
	$effect(() => {
		if (isPaused) return;
		const timer = setTimeout(onDismiss, toast.durationMs);
		return () => clearTimeout(timer);
	});

	async function runAction() {
		if (!toast.action || isRunning) return;
		isRunning = true;
		onDismiss();
		await toast.action.run();
	}

	const tone = $derived(
		toast.tone === TOAST_TONES.ERROR
			? 'border-red-300 bg-red-50 text-red-950'
			: 'border-stone-300 bg-[#fcfaf5] text-stone-900'
	);
</script>

<div
	class="pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg {tone}"
	role={toast.tone === TOAST_TONES.ERROR ? 'alert' : 'status'}
	onmouseenter={() => (isPaused = true)}
	onmouseleave={() => (isPaused = false)}
	onfocusin={() => (isPaused = true)}
	onfocusout={() => (isPaused = false)}
>
	<p class="min-w-0 flex-1 leading-snug">{toast.message}</p>
	{#if toast.action}
		<button
			type="button"
			onclick={runAction}
			class="shrink-0 cursor-pointer rounded-md px-2 py-0.5 text-sm font-semibold text-emerald-800 underline underline-offset-2 hover:bg-emerald-100 focus-visible:outline-2 focus-visible:outline-emerald-700"
		>
			{toast.action.label}
		</button>
	{/if}
	<button
		type="button"
		onclick={onDismiss}
		aria-label="Dismiss"
		class="shrink-0 cursor-pointer rounded-md p-0.5 text-stone-500 hover:bg-stone-200/70 hover:text-stone-900 focus-visible:outline-2 focus-visible:outline-emerald-700"
	>
		<X class="h-4 w-4" />
	</button>
</div>
