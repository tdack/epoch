<script lang="ts">
	import { dateFormatReader } from '#lib/components/date-format.js';
	import { chartDates, type PedigreeDto } from '#lib/shared/charts.js';
	import { brickWalls, completeness } from '#lib/shared/pedigree-stats.js';

	interface Props {
		/** The pedigree the gaps are read from, as the viewer may see it. */
		chart: PedigreeDto;
		/** The address of a person's page. */
		personHref: (id: string) => string;
		/** Heading level of the two parts. */
		level?: 2 | 3;
	}

	let { chart, personHref, level = 2 }: Props = $props();
	const format = dateFormatReader();
	const rows = $derived(completeness(chart));
	const walls = $derived(brickWalls(chart));
	const heading = $derived(`h${level}`);
	const percent = (found: number, possible: number) => `${Math.round((found / possible) * 100)}%`;
</script>

<div class="mt-5 max-w-3xl space-y-4">
	<section aria-labelledby="completeness-heading" class="section-card">
		<svelte:element this={heading} id="completeness-heading" class="section-heading"
			>Ancestors found, by generation</svelte:element
		>
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
		<svelte:element this={heading} id="walls-heading" class="section-heading"
			>Brick walls</svelte:element
		>
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
