<script lang="ts">
	import PrintButton from '#lib/components/layout/PrintButton.svelte';
	import { dateReader } from '#lib/components/date-format.js';
	import CsvDownload from '#lib/components/lists/CsvDownload.svelte';
	import ReportHeader from '#lib/components/reports/ReportHeader.svelte';
	import {
		CITATION_QUALITY_LABELS,
		MAX_SOURCE_USAGE_CITATIONS,
		sourceLabel
	} from '#lib/shared/evidence.js';
	import { treePath } from '#lib/shared/tree-slug.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const showDate = dateReader();

	const source = $derived(data.source);
	const title = $derived(sourceLabel(source));
	const base = $derived(treePath(data.summary.tree));
	const sourceHref = $derived(`${base}/sources/${encodeURIComponent(source.id)}`);
	const hrefOf = (group: { personId: string | null; unionId: string | null }) =>
		group.personId
			? `${base}/people/${encodeURIComponent(group.personId)}`
			: group.unionId
				? `${base}/unions/${encodeURIComponent(group.unionId)}`
				: null;

	// One row per citation. A group's label repeats on each of its rows so every row stands alone
	// for a screen reader and a spreadsheet.
	const rows = $derived(
		source.groups.flatMap((group) =>
			group.citations.map((citation) => ({
				key: citation.id,
				label: group.label,
				href: hrefOf(group),
				date: showDate(group.fact?.dateText),
				place: group.fact?.place ?? '',
				detail:
					[
						citation.page,
						citation.quality !== null ? CITATION_QUALITY_LABELS[citation.quality] : null,
						citation.text
					]
						.filter(Boolean)
						.join(' · ') || ''
			}))
		)
	);
	const HEADER = ['Supports', 'Date', 'Place', 'Page or detail'];
</script>

<svelte:head>
	<title>Usage of {title} · Sources · Epoch</title>
</svelte:head>

<ReportHeader
	crumbs={[
		{ label: data.summary.tree.name, href: base },
		{ label: title, href: sourceHref }
	]}
	title="What {title} supports"
>
	{#snippet summary()}
		{source.citationCount}
		{source.citationCount === 1 ? 'citation' : 'citations'} of this source, grouped by what they support.
	{/snippet}
	{#snippet actions()}
		<CsvDownload
			filename="source-usage.csv"
			header={HEADER}
			rows={rows.map((r) => [r.label, r.date, r.place, r.detail])}
		/>
		<PrintButton />
	{/snippet}
</ReportHeader>

{#if source.hasMore}
	<p class="mt-3 text-sm text-stone-700" role="status" data-testid="usage-capped">
		This report stops at the first {MAX_SOURCE_USAGE_CITATIONS} of {source.citationCount} citations.
	</p>
{/if}

{#if rows.length === 0}
	<p class="mt-4 text-sm text-stone-600">Nothing you can see cites this source.</p>
{:else}
	<div class="report-panel mt-4">
		<table class="report-table" data-testid="usage-table">
			<caption class="sr-only">What {title} supports</caption>
			<thead>
				<tr>
					{#each HEADER as h (h)}<th scope="col">{h}</th>{/each}
				</tr>
			</thead>
			<tbody>
				{#each rows as row (row.key)}
					<tr>
						<th scope="row">
							{#if row.href}<a href={row.href} class="text-link">{row.label}</a
								>{:else}{row.label}{/if}
						</th>
						<td class="whitespace-nowrap">{row.date}</td>
						<td>{row.place}</td>
						<td>{row.detail}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
