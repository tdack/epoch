<script lang="ts">
	import { onMount } from 'svelte';

	interface Props {
		/** Whether the viewer may relate two people, so the drag gesture is worth mentioning. */
		canRelate: boolean;
	}

	let { canRelate }: Props = $props();

	const STORAGE_KEY = 'epoch.tree-gesture-hint.dismissed';

	/**
	 * Starts hidden and appears once the stored choice is read, so a returning viewer never sees it
	 * flash during hydration.
	 */
	let isShown = $state(false);
	let isTouch = $state(false);

	onMount(() => {
		isTouch = matchMedia('(pointer: coarse)').matches;
		try {
			isShown = localStorage.getItem(STORAGE_KEY) !== '1';
		} catch {
			// Storage blocked: show it, and Got it still hides it for this visit.
			isShown = true;
		}
	});

	function dismiss() {
		isShown = false;
		try {
			localStorage.setItem(STORAGE_KEY, '1');
		} catch {
			// Remembering the dismissal is a convenience only.
		}
	}
</script>

{#if isShown}
	<div
		class="mb-2 flex items-start gap-3 rounded-lg border border-stone-200 bg-[#fdfbf7] px-3 py-2 text-xs leading-relaxed text-stone-700"
	>
		<p class="min-w-0 flex-1">
			{#if isTouch}
				<strong class="font-semibold text-stone-900">Tap</strong> a person to centre the tree on
				them. <strong class="font-semibold text-stone-900">Press and hold</strong> to see their details.
			{:else}
				<strong class="font-semibold text-stone-900">Click</strong> a person to centre the tree on
				them. <strong class="font-semibold text-stone-900">Double-click</strong> to see their
				details, or <strong class="font-semibold text-stone-900">right-click</strong> for more.
				{#if canRelate}Drag one person onto another to relate them.{/if}
			{/if}
		</p>
		<button
			type="button"
			onclick={dismiss}
			class="shrink-0 cursor-pointer rounded-md px-1.5 py-0.5 font-semibold text-emerald-800 focus-ring hover:bg-emerald-50 hover:text-emerald-700 coarse:min-h-11"
		>
			Got it
		</button>
	</div>
{/if}
