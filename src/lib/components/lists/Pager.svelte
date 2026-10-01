<script lang="ts">
	interface Props {
		/** Address of the previous page, or null on the first. */
		previousHref: string | null;
		/** Address of the next page, or null on the last. */
		nextHref: string | null;
		/** Describes the page for people using a screen reader, e.g. "Showing 51 to 100". */
		summary: string;
	}

	let { previousHref, nextHref, summary }: Props = $props();
</script>

<nav class="flex items-center justify-between gap-3 text-sm" aria-label="Pages">
	<span class="text-stone-600" aria-live="polite">{summary}</span>
	<span class="flex gap-2">
		{#if previousHref}
			<a href={previousHref} rel="prev" class="btn">Previous</a>
		{:else}
			<span class="btn opacity-40" aria-disabled="true">Previous</span>
		{/if}
		{#if nextHref}
			<a href={nextHref} rel="next" class="btn">Next</a>
		{:else}
			<span class="btn opacity-40" aria-disabled="true">Next</span>
		{/if}
	</span>
</nav>

<style>
	.btn {
		display: inline-flex;
		padding: 4px 12px;
		border: 1px solid #d6d3d1;
		border-radius: 8px;
		background: white;
		font-weight: 600;
		color: #1c1917;
	}
	a.btn:hover {
		background: #f5f5f4;
	}
</style>
