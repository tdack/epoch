<script lang="ts">
	import PrintButton from '#lib/components/layout/PrintButton.svelte';
	import { dateReader } from '#lib/components/date-format.js';
	import CsvDownload from '#lib/components/lists/CsvDownload.svelte';
	import { MAX_PLACE_REPORT_FACTS } from '#lib/shared/places.js';
	import { treePath } from '#lib/shared/tree-slug.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const showDate = dateReader();

	const place = $derived(data.place);
	const base = $derived(treePath(data.summary.tree));
	const placeHref = $derived(`${base}/place?name=${encodeURIComponent(place.name)}`);
	const entityHref = (kind: 'person' | 'partnership', id: string) =>
		`${base}/${kind === 'person' ? 'people' : 'unions'}/${encodeURIComponent(id)}`;
	const HEADER = ['Fact', 'Of', 'Date'];
	const rows = $derived(
		place.facts.map((f) => [f.label, f.entityName, showDate(f.dateText) || 'Date unknown'])
	);
</script>

<svelte:head>
	<title>Report: {place.name} · Places · {data.summary.tree.name} · Epoch</title>
</svelte:head>

<nav aria-label="Breadcrumb" class="text-xs text-stone-600 print:hidden">
	<a href="{base}/places" class="text-link">Places</a>
	<span aria-hidden="true"> › </span>
	<a href={placeHref} class="text-link">{place.name}</a>
</nav>

<header class="flex flex-wrap items-start justify-between gap-3">
	<div>
		<h1 class="text-2xl font-bold text-stone-900">Place report</h1>
		<p class="mt-1 text-sm text-stone-600">{place.name} · {place.facts.length} facts, by date</p>
	</div>
	<div class="flex flex-wrap items-center gap-3 print:hidden">
		<a href={placeHref} class="text-link text-sm">Back to the place</a>
		<CsvDownload filename="place-report.csv" header={HEADER} {rows} />
		<PrintButton />
	</div>
</header>

{#if place.hasMore}
	<p class="mt-3 text-sm text-stone-700" role="status" data-testid="report-capped">
		This report stops at the first {MAX_PLACE_REPORT_FACTS} facts, by date.
	</p>
{/if}

<table class="mt-4 w-full text-left text-sm" data-testid="place-report-table">
	<caption class="sr-only">Facts at {place.name}</caption>
	<thead>
		<tr class="border-b border-stone-300">
			{#each HEADER as h (h)}<th scope="col" class="py-1 pr-3 font-semibold">{h}</th>{/each}
		</tr>
	</thead>
	<tbody>
		{#each place.facts as fact (fact.id)}
			<tr class="break-inside-avoid border-b border-stone-200">
				<th scope="row" class="py-1 pr-3 font-normal">{fact.label}</th>
				<td class="py-1 pr-3"
					><a href={entityHref(fact.kind, fact.entityId)} class="text-link">{fact.entityName}</a
					></td
				>
				<td class="py-1">{showDate(fact.dateText) || 'Date unknown'}</td>
			</tr>
		{/each}
	</tbody>
</table>
