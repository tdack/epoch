<script lang="ts">
	import { RefreshCw } from '@lucide/svelte';
	import { invalidateAll } from '$app/navigation';
	import { isInstalledApp, PULL_THRESHOLD_PX, pullToRefresh } from './pull-to-refresh.js';

	let distancePx = $state(0);
	let isRefreshing = $state(false);

	async function refresh() {
		if (isRefreshing) return;
		isRefreshing = true;
		// Re-runs the loads rather than reloading, so scroll, open panels and drafts survive.
		try {
			await invalidateAll();
		} finally {
			isRefreshing = false;
		}
	}

	$effect(() => {
		if (!isInstalledApp()) return;
		return pullToRefresh(
			(d) => (distancePx = d),
			() => void refresh()
		);
	});

	const offsetPx = $derived(isRefreshing ? PULL_THRESHOLD_PX : distancePx);
</script>

{#if offsetPx > 0}
	<div
		class="pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-center"
		style:transform="translateY({offsetPx - 40}px)"
		aria-hidden="true"
	>
		<span class="rounded-full bg-white p-2 text-emerald-800 shadow-md">
			<RefreshCw
				class="h-5 w-5 {isRefreshing ? 'motion-safe:animate-spin' : ''}"
				style="transform: rotate({(distancePx / PULL_THRESHOLD_PX) * 270}deg)"
			/>
		</span>
	</div>
{/if}
