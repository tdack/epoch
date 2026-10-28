<script lang="ts">
	import PrintButton from '#lib/components/layout/PrintButton.svelte';
	import { dateReader } from '#lib/components/date-format.js';
	import CsvDownload from '#lib/components/lists/CsvDownload.svelte';
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

<nav aria-label="Breadcrumb" class="text-xs text-stone-600 print:hidden">
	<a href={base} class="text-link">{data.summary.tree.name}</a>
	<span aria-hidden="true"> › </span>
	<a href={sourceHref} class="text-link">{title}</a>
</nav>

<header class="flex flex-wrap items-start justify-between gap-3">
	<div>
		<h1 class="text-2xl font-bold text-stone-900">Source usage</h1>
		<p class="mt-1 text-sm text-stone-600">
			{title} · {source.citationCount}
			{source.citationCount === 1 ? 'citation' : 'citations'}
		</p>
	</div>
	<div class="flex flex-wrap items-center gap-3 print:hidden">
		<a href={sourceHref} class="text-link text-sm">Back to the source</a>
		<CsvDownload
			filename="source-usage.csv"
			header={HEADER}
			rows={rows.map((r) => [r.label, r.date, r.place, r.detail])}
		/>
		<PrintButton />
	</div>
</header>

{#if source.hasMore}
	<p class="mt-3 text-sm text-stone-700" role="status" data-testid="usage-capped">
		This report stops at the first {MAX_SOURCE_USAGE_CITATIONS} of {source.citationCount} citations.
	</p>
{/if}

{#if rows.length === 0}
	<p class="mt-4 text-sm text-stone-600">Nothing you can see cites this source.</p>
{:else}
	<table class="mt-4 w-full text-left text-sm" data-testid="usage-table">
		<caption class="sr-only">What {title} supports</caption>
		<thead>
			<tr class="border-b border-stone-300">
				{#each HEADER as h (h)}<th scope="col" class="py-1 pr-3 font-semibold">{h}</th>{/each}
			</tr>
		</thead>
		<tbody>
			{#each rows as row (row.key)}
				<tr class="break-inside-avoid border-b border-stone-200 align-top">
					<th scope="row" class="py-1 pr-3 font-normal">
						{#if row.href}<a href={row.href} class="text-link">{row.label}</a
							>{:else}{row.label}{/if}
					</th>
					<td class="py-1 pr-3">{row.date}</td>
					<td class="py-1 pr-3">{row.place}</td>
					<td class="py-1">{row.detail}</td>
				</tr>
			{/each}
		</tbody>
	</table>
{/if}
