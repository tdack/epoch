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

<div class="mt-6 max-w-3xl space-y-8">
	<section aria-labelledby="completeness-heading">
		<svelte:element this={heading} id="completeness-heading" class="section-heading"
			>Ancestors found, by generation</svelte:element
		>
		<div class="report-panel mt-2">
			<table class="report-table" data-testid="completeness">
				<thead>
					<tr>
						<th scope="col">Generation</th>
						<th scope="col" class="text-right">Found</th>
						<th scope="col" class="text-right">Possible</th>
						<th scope="col">Complete</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as row (row.generation)}
						<tr>
							<th scope="row">{row.generation}</th>
							<td class="text-right">
								{row.found}{#if row.distinct < row.found}
									<span class="block text-xs text-stone-600">{row.distinct} different people</span>
								{/if}
							</td>
							<td class="text-right">{row.possible}</td>
							<td>
								<span class="flex items-center gap-2">
									<span class="w-10 text-right">{percent(row.found, row.possible)}</span>
									<!-- The share drawn as well as said, so the generations compare at a glance. -->
									<span
										class="h-1.5 w-24 overflow-hidden rounded-full bg-stone-200 print:border print:border-stone-400"
										aria-hidden="true"
									>
										<span
											class="block h-full bg-stone-600"
											style:width={percent(row.found, row.possible)}
										></span>
									</span>
								</span>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<section aria-labelledby="walls-heading">
		<svelte:element this={heading} id="walls-heading" class="section-heading"
			>Brick walls</svelte:element
		>
		<p class="mt-1 max-w-prose text-sm text-pretty text-stone-600">
			Ancestors with a parent not recorded, below the top generation shown. Numbers are Ahnentafel:
			the parents of number n are 2n and 2n + 1.
		</p>
		{#if walls.length === 0}
			<p class="mt-3 text-sm text-stone-700">Every ancestor shown has both parents recorded.</p>
		{:else}
			<ul
				class="report-panel mt-3 divide-y divide-stone-100 text-sm print:divide-stone-200"
				data-testid="brick-walls"
			>
				{#each walls as wall (wall.person.id)}
					<li
						class="flex break-inside-avoid flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2 print:px-0 print:py-1"
					>
						<span class="w-8 shrink-0 text-right font-semibold text-stone-500 tabular-nums"
							>{wall.number}.</span
						>
						<a class="text-link" href={personHref(wall.person.id)}>{wall.person.name}</a>
						<span class="text-stone-600 tabular-nums">
							{chartDates(wall.person.birth, wall.person.death, format())}
						</span>
						<span class="ml-auto text-stone-700">
							{wall.missingParents === 2 ? 'No parents recorded' : 'One parent not recorded'}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>
