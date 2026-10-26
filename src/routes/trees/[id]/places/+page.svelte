<script lang="ts">
	import PlaceInput from '#lib/components/forms/PlaceInput.svelte';
	import Pager from '#lib/components/lists/Pager.svelte';
	import PlaceMap from '#lib/components/maps/PlaceMap.svelte';
	import { isInBounds, type MapBounds, type MapMarker } from '#lib/shared/geo.js';
	import type { PageProps } from './$types';
	import { treePath } from '#lib/shared/tree-slug.js';
	import { hasMinimumRole } from '#lib/shared/roles.js';

	let { data }: PageProps = $props();

	const base = $derived(treePath(data.summary.tree));
	const page = $derived(data.page);
	const role = $derived(data.trees.find((t) => t.id === data.summary.tree.id)?.role);
	const canMatch = $derived(role !== undefined && hasMinimumRole(role, 'manager'));
	let filterText = $derived(data.q);
	const placeHref = (name: string) => `${base}/place?name=${encodeURIComponent(name)}`;
	const markers = $derived<MapMarker[]>(
		data.map.points.map((p) => ({
			id: p.placeId,
			label: p.name,
			href: placeHref(p.name),
			latitude: p.latitude,
			longitude: p.longitude,
			count: p.factCount
		}))
	);
	let bounds = $state<MapBounds | null>(null);
	let isOnlyInView = $state(false);
	// The map data is the whole tree's, so this list needs no server round trip as the map moves.
	const inView = $derived(
		data.map.points.filter(
			(p) =>
				(bounds === null || isInBounds(p.latitude, p.longitude, bounds)) &&
				p.name.toLowerCase().includes(data.q.toLowerCase())
		)
	);
	const query = (isUnlocated: boolean, offset = 0) => {
		const params = new URLSearchParams();
		if (data.q) params.set('q', data.q);
		if (isUnlocated) params.set('unlocated', '1');
		if (offset > 0) params.set('offset', String(offset));
		return `${base}/places${params.size > 0 ? `?${params}` : ''}`;
	};
	const pageHref = (offset: number) => query(data.isUnlocated, offset);
</script>

<svelte:head>
	<title>Places · {data.summary.tree.name} · Epoch</title>
</svelte:head>

<header>
	<h1 class="text-2xl font-bold text-stone-900">Places</h1>
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
	{#if data.isUnlocated}<input type="hidden" name="unlocated" value="1" />{/if}
	<button type="submit" class="btn-primary">Find</button>
</form>

<div class="mt-4 grid gap-4 lg:grid-cols-2 lg:items-start">
	<div class="lg:sticky lg:top-4">
		{#if data.map.points.length === 0}
			<p
				class="rounded-xl border border-dashed border-stone-300 p-4 text-sm text-stone-700"
				data-testid="no-locations"
			>
				No place has a location yet. Locations come from coordinates in an imported file, or you can
				set one on each place's page.
			</p>
		{:else}
			<PlaceMap
				class="h-72 lg:h-[32rem]"
				label="Map of places with a location. Pins are not keyboard targets; the list of places beside or below it has the same places."
				{markers}
				tileUrl={data.tiles.tileUrl}
				tileAttribution={data.tiles.tileAttribution}
				onviewportchange={(b) => (bounds = b)}
			/>
			<label class="mt-2 flex items-center gap-2 text-sm text-stone-700">
				<input type="checkbox" class="switch" bind:checked={isOnlyInView} />
				Only places in view
			</label>
		{/if}
		{#if data.map.unlocatedCount > 0 || data.isUnlocated}
			<p class="mt-2 text-sm text-stone-700" data-testid="unlocated-note">
				{#if data.isUnlocated}
					Showing places with no location.
					<a href={query(false)} class="text-link">Show all places</a>
				{:else}
					{data.map.unlocatedCount}
					{data.map.unlocatedCount === 1 ? 'place has' : 'places have'} no location.
					<a href={query(true)} class="text-link">Show them</a>
				{/if}
				{#if canMatch && data.map.unlocatedCount > 0}
					<a href="{base}/places/match" class="text-link ml-2" data-testid="match-places-link"
						>Match places</a
					>
				{/if}
			</p>
		{/if}
	</div>

	<div>
		{#if isOnlyInView && data.map.points.length > 0}
			{#if inView.length === 0}
				<p class="text-sm text-stone-700" data-testid="no-places">No place in view.</p>
			{:else}
				<ul
					class="divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white"
					data-testid="places-list"
				>
					{#each inView as item (item.placeId)}
						<li class="flex items-baseline justify-between px-4 py-2 text-sm">
							<a href={placeHref(item.name)} class="font-semibold text-emerald-900 hover:underline"
								>{item.name}</a
							>
							<span class="text-stone-600"
								>{item.factCount}
								{item.factCount === 1 ? 'fact' : 'facts'}{#if item.peopleCount > 0}, {item.peopleCount}
									{item.peopleCount === 1 ? 'person' : 'people'}{/if}</span
							>
						</li>
					{/each}
				</ul>
			{/if}
		{:else if page.items.length === 0}
			<p class="text-sm text-stone-700" data-testid="no-places">
				{data.q
					? 'No place matches.'
					: data.isUnlocated
						? 'Every place has a location.'
						: 'No places recorded.'}
			</p>
		{:else}
			<ul
				class="divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white"
				data-testid="places-list"
			>
				{#each page.items as item (item.name)}
					<li class="flex items-baseline justify-between px-4 py-2 text-sm">
						<a href={placeHref(item.name)} class="font-semibold text-emerald-900 hover:underline"
							>{item.name}</a
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
</div>
