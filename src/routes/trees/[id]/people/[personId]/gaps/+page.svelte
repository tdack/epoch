<script lang="ts">
	import GenerationStepper from '#lib/components/charts/GenerationStepper.svelte';
	import { dateFormatReader } from '#lib/components/date-format.js';
	import { chartDates, MAX_PEDIGREE_GENERATIONS } from '#lib/shared/charts.js';
	import { brickWalls, completeness } from '#lib/shared/pedigree-stats.js';
	import { treePath } from '#lib/shared/tree-slug.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const chart = $derived(data.chart);
	const base = $derived(treePath(data.summary.tree));
	const format = dateFormatReader();
	const personHref = (id: string) => `${base}/people/${encodeURIComponent(id)}`;
	const rows = $derived(completeness(chart));
	const walls = $derived(brickWalls(chart));
	const heading = $derived(`Research gaps for ${chart.person.name}`);
	const percent = (found: number, possible: number) => `${Math.round((found / possible) * 100)}%`;
</script>

<svelte:head>
	<title>{heading} · {data.summary.tree.name} · Epoch</title>
</svelte:head>

<nav aria-label="Breadcrumb" class="text-sm text-stone-600 print:hidden">
	<a href={base} class="text-link">{data.summary.tree.name}</a> /
	<a href={personHref(chart.person.id)} class="text-link">{chart.person.name}</a>
</nav>
<h1 class="mt-1 text-2xl font-bold text-stone-900">{heading}</h1>

<div class="mt-3 flex flex-wrap items-center gap-3 text-sm print:hidden">
	<GenerationStepper
		label="Generations"
		value={chart.generations}
		max={MAX_PEDIGREE_GENERATIONS}
		hrefFor={(n) => `${personHref(chart.person.id)}/gaps?generations=${n}`}
	/>
	<button type="button" class="action-btn" onclick={() => window.print()}>Print</button>
</div>

<div class="mt-5 max-w-3xl space-y-4">
	<section aria-labelledby="completeness-heading" class="section-card">
		<h2 id="completeness-heading" class="section-heading">Ancestors found, by generation</h2>
		<table class="mt-2 w-full text-left text-sm" data-testid="completeness">
			<thead class="border-b border-stone-300 text-stone-600">
				<tr>
					<th scope="col" class="py-1.5 pr-3 font-semibold">Generation</th>
					<th scope="col" class="py-1.5 pr-3 font-semibold">Found</th>
					<th scope="col" class="py-1.5 pr-3 font-semibold">Possible</th>
					<th scope="col" class="py-1.5 font-semibold">Complete</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as row (row.generation)}
					<tr class="border-b border-stone-200">
						<th scope="row" class="py-1.5 pr-3 font-normal">{row.generation}</th>
						<td class="py-1.5 pr-3">
							{row.found}{#if row.distinct < row.found}
								<span class="text-stone-600"> ({row.distinct} different people)</span>
							{/if}
						</td>
						<td class="py-1.5 pr-3">{row.possible}</td>
						<td class="py-1.5">{percent(row.found, row.possible)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</section>

	<section aria-labelledby="walls-heading" class="section-card">
		<h2 id="walls-heading" class="section-heading">Brick walls</h2>
		<p class="mt-1 text-sm text-stone-600">
			Ancestors with a parent not recorded, below the top generation shown. Numbers are Ahnentafel:
			parents of number n are 2n and 2n + 1.
		</p>
		{#if walls.length === 0}
			<p class="mt-2 text-sm text-stone-600">Every ancestor shown has both parents recorded.</p>
		{:else}
			<ul class="mt-2 space-y-1.5 text-sm" data-testid="brick-walls">
				{#each walls as wall (wall.person.id)}
					<li class="break-inside-avoid">
						<span class="font-semibold tabular-nums">{wall.number}.</span>
						<a class="text-link" href={personHref(wall.person.id)}>{wall.person.name}</a>
						<span class="text-stone-600">
							{chartDates(wall.person.birth, wall.person.death, format())}
							· {wall.missingParents === 2 ? 'no parents recorded' : 'one parent not recorded'}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>
