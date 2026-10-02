<script lang="ts">
	import Pager from '#lib/components/lists/Pager.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const base = $derived(`/trees/${encodeURIComponent(data.summary.tree.id)}`);
	const place = $derived(data.place);
	const entityHref = (kind: 'person' | 'partnership', id: string) => `${base}/${kind === 'person' ? 'people' : 'unions'}/${encodeURIComponent(id)}`;
	const pageHref = (offset: number) => `${base}/place?name=${encodeURIComponent(place.name)}${offset > 0 ? `&offset=${offset}` : ''}`;
</script>

<svelte:head>
	<title>{place.name} · Places · {data.summary.tree.name} · Epoch</title>
</svelte:head>

<nav aria-label="Breadcrumb" class="text-sm text-stone-600">
	<a href="{base}/places" class="font-semibold text-emerald-800 hover:underline">Places</a>
</nav>
<h2 class="mt-1 text-2xl font-bold text-stone-900" data-testid="place-name">{place.name}</h2>

<ul class="mt-4 divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white" data-testid="place-facts">
	{#each place.facts as fact (fact.id)}
		<li class="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2 text-sm">
			<span>
				<span class="font-semibold text-stone-900">{fact.label}</span>
				<span class="text-stone-600"> of </span>
				<a href={entityHref(fact.kind, fact.entityId)} class="font-semibold text-emerald-900 hover:underline">{fact.entityName}</a>
			</span>
			<span class="text-stone-600">{fact.dateText ?? 'Date unknown'}</span>
		</li>
	{/each}
</ul>
<Pager
	summary="Showing {place.offset + 1} to {place.offset + place.facts.length}"
	previousHref={place.offset > 0 ? pageHref(Math.max(0, place.offset - place.limit)) : null}
	nextHref={place.hasMore ? pageHref(place.offset + place.limit) : null}
/>
