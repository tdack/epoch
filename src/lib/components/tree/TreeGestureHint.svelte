<script lang="ts">
	import { onMount } from 'svelte';

	interface Props {
		/**
		 * Whether the chart has a context menu. The overviews have none, so the hint does not send
		 * anyone to it there; elsewhere even a viewer's menu offers Open profile, which double-click
		 * does not.
		 */
		hasMenuActions: boolean;
		/**
		 * Float over the top of the chart as one line instead of taking a row above it. On a phone that
		 * row is height the chart needs, and the hint matters only until it is read once.
		 */
		isOverlay?: boolean;
	}

	let { hasMenuActions, isOverlay = false }: Props = $props();

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
		class="flex gap-3 rounded-lg border border-stone-200 bg-[#fdfbf7] text-xs leading-relaxed text-stone-700 {isOverlay
			? 'absolute inset-x-3 top-[4.25rem] z-20 items-center py-0.5 pl-3 shadow-md'
			: 'mb-2 items-start px-3 py-2'}"
	>
		<p class="min-w-0 flex-1">
			{#if isTouch && isOverlay}
				<strong class="font-semibold text-stone-900">Tap</strong> to centre.
				<strong class="font-semibold text-stone-900">Hold</strong> for details.
			{:else if isTouch}
				<strong class="font-semibold text-stone-900">Tap</strong> a person to centre the tree on
				them. <strong class="font-semibold text-stone-900">Press and hold</strong> to see their details.
			{:else}
				<strong class="font-semibold text-stone-900">Click</strong> a person to centre the tree on
				them. <strong class="font-semibold text-stone-900">Double-click</strong> to see their
				details{#if hasMenuActions}, or
					<strong class="font-semibold text-stone-900">right-click</strong> for more{/if}.
			{/if}
		</p>
		<button
			type="button"
			onclick={dismiss}
			class="min-h-8 shrink-0 cursor-pointer rounded-md px-2 font-semibold text-emerald-800 focus-ring hover:bg-emerald-50 hover:text-emerald-700 coarse:min-h-11"
		>
			Got it
		</button>
	</div>
{/if}
