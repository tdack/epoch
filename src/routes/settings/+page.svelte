<script lang="ts">
	import SourceLink from '#lib/components/layout/SourceLink.svelte';
	import type { PageData } from './$types';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();
</script>

<svelte:head>
	<title>Settings · Epoch</title>
</svelte:head>

<!-- Only someone with no tree reaches this: everyone else is sent to the settings in a tree. -->
<div class="flex min-h-screen flex-col bg-[#fcf9f2] font-sans text-stone-800">
	<main class="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center p-6">
		<h1 class="text-2xl font-bold text-stone-900">Settings</h1>
		<p class="mt-2 text-sm text-stone-600">
			Your settings open beside a tree, and you have none yet. Create or import one first.
		</p>
		<p class="mt-4">
			<a href="/" class="text-sm font-semibold text-emerald-900 underline">Start a tree</a>
		</p>
	</main>
	<footer class="px-6 pb-4 text-center">
		<SourceLink href={data.sourceUrl} commit={data.sourceCommit} />
	</footer>
</div>
