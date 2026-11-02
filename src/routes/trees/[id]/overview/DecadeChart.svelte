<script lang="ts">
	interface Props {
		/** Every decade from the first birth to the last, empty ones included, so a gap shows. */
		decades: { decade: number; people: number }[];
		/** Id of the card heading that names this chart for assistive technology. */
		labelledBy: string;
	}

	let { decades, labelledBy }: Props = $props();

	// "1760s" at text-xs is about 36px; a mid label is centred, so it needs half a label of clear
	// space beside each neighbour's label too. Fixed decade gaps overlapped on a phone.
	const MIN_LABEL_PX = 56;
	let widthPx = $state(0);

	const widest = $derived(Math.max(1, ...decades.map((d) => d.people)));
	const peakIndex = $derived(decades.findIndex((d) => d.people === widest));
	const filled = $derived(decades.filter((d) => d.people > 0));
	// Centuries only, thinned to every Nth century once they would crowd; zero width (before the
	// first measure) labels the ends alone.
	const centuryStep = $derived.by(() => {
		const slotPx = widthPx / decades.length;
		return slotPx > 0 ? Math.ceil(MIN_LABEL_PX / (slotPx * 10)) : Infinity;
	});
	const edgeGap = $derived(
		widthPx > 0 ? Math.ceil(MIN_LABEL_PX / (widthPx / decades.length)) : Infinity
	);
	const isLabelled = (i: number, decade: number) =>
		i === 0 ||
		i === decades.length - 1 ||
		(decade % (100 * centuryStep) === 0 && i >= edgeGap && decades.length - 1 - i >= edgeGap);
	const births = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'birth' : 'births'}`;
</script>

<!-- The bars repeat the list below them, and 25 zero-count items read aloud say nothing. -->
<ol
	class="mt-4 flex h-28 items-end gap-px"
	aria-hidden="true"
	data-testid="overview-decades"
	bind:clientWidth={widthPx}
>
	{#each decades as row, i (row.decade)}
		<li class="group relative flex h-full min-w-0 flex-1 flex-col justify-end">
			{#if row.people > 0}
				<!-- Hover reveals every value; the peak is always shown so no reading needs a pointer. -->
				<span
					class="pointer-events-none mb-0.5 text-center text-xs font-semibold text-stone-800 tabular-nums transition-opacity {i ===
					peakIndex
						? ''
						: 'opacity-0 group-hover:opacity-100'}">{row.people}</span
				>
			{/if}
			<div
				title="{row.decade}s: {births(row.people)}"
				class="mx-auto w-full max-w-8 rounded-t-sm transition-colors {row.people > 0
					? 'bg-stone-600 group-hover:bg-stone-800'
					: 'bg-stone-500'}"
				style:height={row.people > 0 ? `${(row.people / widest) * 80}%` : '2px'}
			></div>
			{#if isLabelled(i, row.decade)}
				<span
					class="absolute top-full mt-1 text-xs whitespace-nowrap text-stone-600 tabular-nums {i ===
					0
						? 'left-0'
						: i === decades.length - 1
							? 'right-0'
							: 'left-1/2 -translate-x-1/2'}">{row.decade}s</span
				>
			{/if}
		</li>
	{/each}
</ol>
<div aria-hidden="true" class="h-5 border-t border-stone-300"></div>
<ul class="sr-only" aria-labelledby={labelledBy}>
	{#each filled as row (row.decade)}
		<li>{row.decade}s: {births(row.people)}</li>
	{/each}
	{#if filled.length < decades.length}
		<li>No dated births in {decades.length - filled.length} other decades.</li>
	{/if}
</ul>
