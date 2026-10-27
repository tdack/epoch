<script lang="ts">
	import { dateFormatReader } from '#lib/components/date-format.js';
	import PlaceMap from '#lib/components/maps/PlaceMap.svelte';
	import { lifeMap, type FactLocation } from '#lib/shared/life-map.js';
	import type { FactDto } from '#lib/shared/person-page.js';

	interface Props {
		/** The person's facts; those with an entry in `locations` are mapped. */
		facts: FactDto[];
		/** Fact id to its place's location, from the page data; already limited to what may be mapped. */
		locations: Record<string, FactLocation>;
		/** Tile URL and attribution, from the site settings. */
		tiles: { tileUrl: string; tileAttribution: string };
		/** Names the map for assistive technology. */
		personName: string;
	}

	let { facts, locations, tiles, personName }: Props = $props();

	const dateFormat = dateFormatReader();
	const data = $derived(lifeMap(facts, locations, dateFormat()));
	const dated = $derived(data.items.filter((i) => i.n !== null));
	const undated = $derived(data.items.filter((i) => i.n === null));
</script>

{#if data.stops.length > 0}
	<div class="space-y-3" data-testid="person-life-map">
		<PlaceMap
			stops={data.stops}
			path={data.path}
			tileUrl={tiles.tileUrl}
			tileAttribution={tiles.tileAttribution}
			label={`Map of ${personName}'s life. The same places are listed below the map.`}
			class="h-72"
		/>
		{#if dated.length > 0}
			<ol class="space-y-0.5 text-sm text-stone-700" aria-label="Places in date order">
				{#each dated as item (item.n)}
					<li>{item.n}. {item.text}</li>
				{/each}
			</ol>
		{/if}
		{#if undated.length > 0}
			<div class="text-sm text-stone-700">
				<p class="font-medium">Undated, not joined by the line</p>
				<ul class="space-y-0.5">
					{#each undated as item, i (i)}
						<li>{item.text}</li>
					{/each}
				</ul>
			</div>
		{/if}
	</div>
{/if}
