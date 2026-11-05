<script lang="ts">
	import { dateFormatReader } from '#lib/components/date-format.js';
	import PlaceMap from '#lib/components/maps/PlaceMap.svelte';
	import { lifeMap } from '#lib/shared/life-map.js';
	import type { PersonPageDto } from '#lib/shared/person-page.js';
	import { lifeFacts, lifeTimeline } from './life-timeline.js';

	interface Props {
		/** The page data; the Life entries with a location in `factLocations` are mapped. */
		dto: PersonPageDto;
		/** Tile URL and attribution, from the site settings. */
		tiles: { tileUrl: string; tileAttribution: string };
	}

	let { dto, tiles }: Props = $props();

	const dateFormat = dateFormatReader();
	const data = $derived(
		lifeMap(
			lifeFacts(lifeTimeline(dto.facts, dto.partnerships, dto.directChildren)),
			dto.factLocations,
			dateFormat()
		)
	);
	const personName = $derived(dto.person.displayName);
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
