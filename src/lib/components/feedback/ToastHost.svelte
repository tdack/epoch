<script lang="ts">
	import ToastItem from './ToastItem.svelte';
	import type { ToastStore } from './toasts.svelte.js';

	interface Props {
		/** The store the page pushes messages into. */
		store: ToastStore;
	}

	let { store }: Props = $props();
</script>

<section
	class="pointer-events-none fixed bottom-4 left-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
	aria-label="Notifications"
>
	{#each store.items as toast (toast.id)}
		<ToastItem {toast} onDismiss={() => store.dismiss(toast.id)} />
	{/each}
</section>

