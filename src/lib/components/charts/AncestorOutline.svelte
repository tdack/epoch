<script lang="ts">
	import { dateFormatReader } from '#lib/components/date-format.js';
	import { chartDates } from '#lib/shared/charts.js';
	import type { ChartPerson } from '#lib/shared/charts.js';

	interface Props {
		/** The pedigree's slots in heap order: slot i is ancestor number i + 1 (the Ahnentafel numbering). */
		slots: ReadonlyArray<ChartPerson | null>;
		/** Where a name leads: the chart of that person. Not called for a "Private" entry. */
		hrefFor: (personId: string) => string;
		/** The disclosure's label; the hourglass shows two lists on one page and needs them told apart. */
		summary?: string;
		/** Test hook; the hourglass has two lists. */
		testId?: string;
	}

	let {
		slots,
		hrefFor,
		summary = 'The same ancestors as a list',
		testId = 'outline'
	}: Props = $props();

	const dateFormat = dateFormatReader();
	const dates = (birth: string | null, death: string | null) =>
		chartDates(birth, death, dateFormat());
	const entries = $derived(
		slots.flatMap((person, i) => (person ? [{ number: i + 1, person }] : []))
	);
	/** Number 1 is the person; an even number is the father (first parent) of number n/2, an odd one the mother. */
	const relation = (n: number) =>
		n === 1 ? 'the person' : `${n % 2 === 0 ? 'first' : 'second'} parent of ${Math.floor(n / 2)}`;
</script>

<details class="mt-4 rounded-xl border border-stone-200 bg-white p-3 text-sm" data-testid={testId}>
	<summary class="cursor-pointer font-semibold text-stone-800">{summary}</summary>
	<p class="mt-2 text-xs text-stone-600">
		Numbered so that a person's first parent is twice their number and the second is twice plus one.
	</p>
	<ol class="mt-2 space-y-1">
		{#each entries as entry (entry.number)}
			<li value={entry.number}>
				{#if entry.person.isPrivate}
					<span class="text-stone-500 italic">Private</span>
				{:else}
					<a href={hrefFor(entry.person.id)} class="font-medium text-emerald-900 hover:underline"
						>{entry.person.name}</a
					>
				{/if}
				<span class="text-stone-600">{dates(entry.person.birth, entry.person.death)}</span>
				<span class="text-xs text-stone-500">({relation(entry.number)})</span>
			</li>
		{/each}
	</ol>
</details>
