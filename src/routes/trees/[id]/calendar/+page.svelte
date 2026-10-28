<script lang="ts">
	import PrintButton from '#lib/components/layout/PrintButton.svelte';
	import { dateReader } from '#lib/components/date-format.js';
	import CsvDownload from '#lib/components/lists/CsvDownload.svelte';
	import ReportHeader from '#lib/components/reports/ReportHeader.svelte';
	import { MONTH_NAMES, anniversaryDateText, anniversaryWhat } from '#lib/shared/calendar.js';
	import { treePath } from '#lib/shared/tree-slug.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const showDate = dateReader();

	const base = $derived(treePath(data.summary.tree));
	const monthName = $derived(MONTH_NAMES[data.month - 1]);
	const dayOf = (monthDay: string) => Number(monthDay.slice(3));
	const HEADER = ['Day', 'Event', 'Date'];
	const rows = $derived(
		data.entries.map((a) => [
			dayOf(a.monthDay),
			anniversaryWhat(a),
			showDate(anniversaryDateText(a))
		])
	);
</script>

<svelte:head>
	<title>Calendar: {monthName} · {data.summary.tree.name} · Epoch</title>
</svelte:head>

<ReportHeader
	crumbs={[
		{ label: data.summary.tree.name, href: base },
		{ label: 'Reports', href: `${base}/reports` }
	]}
	title="Calendar for {monthName}"
>
	{#snippet summary()}
		Births, partnerships and deaths recorded to an exact day, in {monthName}.
	{/snippet}
	{#snippet actions()}
		<form method="get" class="flex items-center gap-2">
			<label for="month" class="font-semibold text-stone-700">Month</label>
			<select id="month" name="month" class="field-input w-auto" value={data.month}>
				{#each MONTH_NAMES as name, i (name)}
					<option value={i + 1}>{name}</option>
				{/each}
			</select>
			<button type="submit" class="action-btn">Show</button>
		</form>
		<CsvDownload filename="calendar-{monthName.toLowerCase()}.csv" header={HEADER} {rows} />
		<a href="{base}/calendar/anniversaries.ics" class="action-btn" download
			>Download all months (.ics)</a
		>
		<PrintButton />
	{/snippet}
</ReportHeader>

{#if data.entries.length === 0}
	<p class="mt-4 text-sm text-stone-600">
		Nothing you can see is recorded to a day in {monthName}.
	</p>
{:else}
	<div class="report-panel mt-4">
		<table class="report-table" data-testid="calendar-table">
			<caption class="sr-only">Anniversaries in {monthName}, by day</caption>
			<thead>
				<tr>
					{#each HEADER as h (h)}<th scope="col">{h}</th>{/each}
				</tr>
			</thead>
			<tbody>
				{#each data.entries as a (a.id)}
					<tr>
						<th scope="row" class="whitespace-nowrap">{dayOf(a.monthDay)} {monthName}</th>
						<td>{anniversaryWhat(a)}</td>
						<td>{showDate(anniversaryDateText(a))}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
