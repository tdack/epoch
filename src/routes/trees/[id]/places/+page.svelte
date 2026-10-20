<script lang="ts">
	import PlaceInput from '#lib/components/forms/PlaceInput.svelte';
	import Pager from '#lib/components/lists/Pager.svelte';
	import type { PageProps } from './$types';
	import { treePath } from '#lib/shared/tree-slug.js';

	let { data }: PageProps = $props();

	const base = $derived(treePath(data.summary.tree));
	const page = $derived(data.page);
	let filterText = $derived(data.q);
	const pageHref = (offset: number) => {
		const params = new URLSearchParams();
		if (data.q) params.set('q', data.q);
		if (offset > 0) params.set('offset', String(offset));
		return `${base}/places${params.size > 0 ? `?${params}` : ''}`;
	};
</script>

<svelte:head>
	<title>Places · {data.summary.tree.name} · Epoch</title>
</svelte:head>

<header>
	<h2 class="text-2xl font-bold text-stone-900">Places</h2>
	<p class="mt-1 max-w-2xl text-sm text-stone-600">
		Every place a fact names, written once however its case varies. The text on each fact is kept
		exactly as entered.
	</p>
</header>

<form method="get" class="mt-4 flex items-end gap-2" role="search">
	<div>
		<label for="place-filter" class="block text-xs font-semibold text-stone-700">Find a place</label
		>
		<PlaceInput
			id="place-filter"
			name="q"
			type="search"
			treeId={data.summary.tree.id}
			bind:value={filterText}
			inputClass="mt-1 w-64 rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
		/>
	</div>
	<button type="submit" class="btn-primary">Find</button>
</form>

<div class="mt-4">
	{#if page.items.length === 0}
		<p class="text-sm text-stone-700" data-testid="no-places">
			{data.q ? 'No place matches.' : 'No places recorded.'}
		</p>
	{:else}
		<ul
			class="divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white"
			data-testid="places-list"
		>
			{#each page.items as item (item.name)}
				<li class="flex items-baseline justify-between px-4 py-2 text-sm">
					<a
						href="{base}/place?name={encodeURIComponent(item.name)}"
						class="font-semibold text-emerald-900 hover:underline">{item.name}</a
					>
					<span class="text-stone-600"
						>{item.facts}
						{item.facts === 1 ? 'fact' : 'facts'}{#if item.people > 0}, {item.people}
							{item.people === 1 ? 'person' : 'people'}{/if}</span
					>
				</li>
			{/each}
		</ul>
		<Pager
			summary="Showing {page.offset + 1} to {page.offset + page.items.length}"
			previousHref={page.offset > 0 ? pageHref(Math.max(0, page.offset - page.limit)) : null}
			nextHref={page.hasMore ? pageHref(page.offset + page.limit) : null}
		/>
	{/if}
</div>
