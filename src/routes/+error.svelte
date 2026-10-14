<script lang="ts">
	import { page } from '$app/state';
	import SourceLink from '#lib/components/layout/SourceLink.svelte';
</script>

<svelte:head>
	<title>{page.status} · Epoch</title>
</svelte:head>

<!-- Replaces SvelteKit's bare default only so a 404 still offers the source, as every page must. -->
<div class="flex min-h-screen flex-col bg-[#fcf9f2] font-sans text-stone-800">
	<main class="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center p-6">
		<h1 class="text-2xl font-bold text-stone-900">{page.status}</h1>
		<p class="mt-2 text-sm text-stone-600">{page.error?.message}</p>
		<a href="/" class="mt-5 text-sm font-semibold text-emerald-800 underline">Back to your trees</a>
	</main>
	<!-- From the root layout load; missing only when that load is what failed. -->
	{#if page.data.sourceUrl}
		<footer class="px-6 pb-4 text-center">
			<SourceLink href={page.data.sourceUrl} commit={page.data.sourceCommit} />
		</footer>
	{/if}
</div>
