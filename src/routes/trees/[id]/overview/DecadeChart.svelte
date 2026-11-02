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
	// With this few decades every slot is wide enough to print its own count.
	const MAX_DECADES_ALL_VALUES = 12;
	const MIN_BAR_PX = 6;
	const isValueShown = (i: number) => decades.length <= MAX_DECADES_ALL_VALUES || i === peakIndex;
	// Roving tabindex: one tab stop for the whole chart instead of one per decade. Null until a bar
	// is focused, so the peak is the way in.
	let focusedIndex = $state<number | null>(null);
	const activeIndex = $derived(focusedIndex ?? peakIndex);
	let listEl: HTMLOListElement | undefined = $state();
	const hintId = $derived(`${labelledBy}-keys`);

	function onBarKeydown(event: KeyboardEvent, i: number) {
		const stops = decades.flatMap((d, n) => (d.people > 0 ? [n] : []));
		const at = stops.indexOf(i);
		const target = {
			ArrowLeft: stops[at - 1],
			ArrowRight: stops[at + 1],
			Home: stops[0],
			End: stops[stops.length - 1]
		}[event.key];
		if (!(event.key in { ArrowLeft: 1, ArrowRight: 1, Home: 1, End: 1 })) return;
		event.preventDefault();
		if (target !== undefined)
			listEl?.querySelector<HTMLElement>(`[data-index="${target}"]`)?.focus();
	}
	const births = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'birth' : 'births'}`;
</script>

<!-- One accessible representation: each non-empty bar is a focusable image named "1840s: 12 births",
	so touch and keyboard users can reach every value. A hidden duplicate list can't hold focusable
	bars (focusable content inside aria-hidden is invalid), so the empty decades are hidden and
	summed up in the single line after the chart instead. -->
<span id={hintId} class="sr-only">Use the left and right arrow keys to move between decades.</span>
<ol
	class="mt-4 flex h-28 items-end gap-px"
	aria-labelledby={labelledBy}
	aria-describedby={hintId}
	bind:this={listEl}
	data-testid="overview-decades"
	bind:clientWidth={widthPx}
>
	{#each decades as row, i (row.decade)}
		<li
			class="relative flex h-full min-w-0 flex-1 flex-col justify-end"
			aria-hidden={row.people === 0}
		>
			{#if row.people > 0}
				<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
				<div
					role="img"
					tabindex={i === activeIndex ? 0 : -1}
					data-index={i}
					onfocus={() => (focusedIndex = i)}
					onkeydown={(event) => onBarKeydown(event, i)}
					aria-label="{row.decade}s: {births(row.people)}"
					class="group flex h-full flex-col justify-end rounded-t-sm focus-ring"
				>
					<!-- Touch has no hover: few decades show every value, many show the peak and reveal the
						rest on hover or keyboard focus. -->
					<span
						class="pointer-events-none mb-0.5 text-center text-xs font-semibold text-stone-800 tabular-nums transition-opacity {isValueShown(
							i
						)
							? ''
							: 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'}"
						>{row.people}</span
					>
					<!-- A floor keeps one birth clearly taller than an empty slot. -->
					<div
						class="mx-auto w-full max-w-8 rounded-t-sm bg-stone-600 transition-colors group-hover:bg-stone-800 group-focus-visible:bg-stone-800"
						style:height="max({MIN_BAR_PX}px, {(row.people / widest) * 80}%)"
					></div>
				</div>
			{:else}
				<!-- A dotted baseline reads as "nothing here" where a short solid bar read as one birth.
					stone-500 is 4.6:1 on the stone-50 card. -->
				<div class="mx-auto w-full max-w-8 border-t-2 border-dotted border-stone-500"></div>
			{/if}
			{#if isLabelled(i, row.decade)}
				<span
					aria-hidden="true"
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
{#if filled.length < decades.length}
	<p class="sr-only">No dated births in {decades.length - filled.length} other decades.</p>
{/if}
