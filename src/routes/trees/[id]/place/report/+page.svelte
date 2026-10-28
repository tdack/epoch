<script lang="ts">
	import PrintButton from '#lib/components/layout/PrintButton.svelte';
	import { dateReader } from '#lib/components/date-format.js';
	import CsvDownload from '#lib/components/lists/CsvDownload.svelte';
	import ReportHeader from '#lib/components/reports/ReportHeader.svelte';
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

<ReportHeader
	crumbs={[
		{ label: 'Places', href: `${base}/places` },
		{ label: place.name, href: placeHref }
	]}
	title="Place report: {place.name}"
>
	{#snippet summary()}
		{place.facts.length} {place.facts.length === 1 ? 'fact' : 'facts'} recorded here, by date.
	{/snippet}
	{#snippet actions()}
		<CsvDownload filename="place-report.csv" header={HEADER} {rows} />
		<PrintButton />
	{/snippet}
</ReportHeader>

{#if place.hasMore}
	<p class="mt-3 text-sm text-stone-700" role="status" data-testid="report-capped">
		This report stops at the first {MAX_PLACE_REPORT_FACTS} facts, by date.
	</p>
{/if}

<div class="report-panel mt-4">
	<table class="report-table" data-testid="place-report-table">
		<caption class="sr-only">Facts at {place.name}</caption>
		<thead>
			<tr>
				{#each HEADER as h (h)}<th scope="col">{h}</th>{/each}
			</tr>
		</thead>
		<tbody>
			{#each place.facts as fact (fact.id)}
				<tr>
					<th scope="row">{fact.label}</th>
					<td
						><a href={entityHref(fact.kind, fact.entityId)} class="text-link">{fact.entityName}</a
						></td
					>
					<td class="whitespace-nowrap">{showDate(fact.dateText) || 'Date unknown'}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
