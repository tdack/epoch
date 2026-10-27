<script lang="ts">
	import { dateReader } from '#lib/components/date-format.js';
	import CsvDownload from '#lib/components/lists/CsvDownload.svelte';
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

<header class="flex flex-wrap items-start justify-between gap-3">
	<div>
		<h1 class="text-2xl font-bold text-stone-900">Calendar</h1>
		<p class="mt-1 text-sm text-stone-600">
			Births, partnerships and deaths recorded to an exact day, in {monthName}.
		</p>
	</div>
	<div class="flex flex-wrap items-center gap-3 print:hidden">
		<CsvDownload filename="calendar-{monthName.toLowerCase()}.csv" header={HEADER} {rows} />
		<a href="{base}/calendar/anniversaries.ics" class="action-btn" download
			>Download all months (.ics)</a
		>
		<button type="button" class="action-btn" onclick={() => window.print()}>Print</button>
	</div>
</header>

<form method="get" class="mt-3 flex items-end gap-2 print:hidden">
	<div>
		<label for="month" class="block text-xs font-semibold text-stone-700">Month</label>
		<select id="month" name="month" class="field-input" value={String(data.month)}>
			{#each MONTH_NAMES as name, i (name)}
				<option value={i + 1} selected={i + 1 === data.month}>{name}</option>
			{/each}
		</select>
	</div>
	<button type="submit" class="action-btn">Show</button>
</form>

<h2 class="mt-5 text-lg font-semibold text-stone-900">{monthName}</h2>
{#if data.entries.length === 0}
	<p class="mt-2 text-sm text-stone-600">
		Nothing you can see is recorded to a day in {monthName}.
	</p>
{:else}
	<table class="mt-2 w-full text-left text-sm" data-testid="calendar-table">
		<caption class="sr-only">Anniversaries in {monthName}, by day</caption>
		<thead>
			<tr class="border-b border-stone-300">
				{#each HEADER as h (h)}<th scope="col" class="py-1 pr-3 font-semibold">{h}</th>{/each}
			</tr>
		</thead>
		<tbody>
			{#each data.entries as a (a.id)}
				<tr class="break-inside-avoid border-b border-stone-200">
					<th scope="row" class="py-1 pr-3 font-normal">{dayOf(a.monthDay)} {monthName}</th>
					<td class="py-1 pr-3">{anniversaryWhat(a)}</td>
					<td class="py-1">{showDate(anniversaryDateText(a))}</td>
				</tr>
			{/each}
		</tbody>
	</table>
{/if}
