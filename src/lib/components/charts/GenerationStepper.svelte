<script lang="ts">
	interface Props {
		/** Names the control, e.g. "Generations" or "Ancestors". */
		label: string;
		/** Generations drawn now, the person's own included. */
		value: number;
		/** The most the chart will draw. */
		max: number;
		/** The address for a chart with this many generations: the depth lives in the address. */
		hrefFor: (generations: number) => string;
		/** Tells tests and assistive technology apart when a page has two steppers. */
		testId?: string;
	}

	let { label, value, max, hrefFor, testId = 'generations' }: Props = $props();
	const labelId = $props.id();
</script>

<span class="font-semibold text-stone-700" id={labelId}>{label}</span>
<div role="group" aria-labelledby={labelId} class="flex items-center gap-1">
	<a
		href={hrefFor(value - 1)}
		aria-label="Fewer {label.toLowerCase()}"
		aria-disabled={value <= 1}
		class="rounded-lg border border-stone-300 px-2.5 py-1 font-semibold {value <= 1
			? 'pointer-events-none opacity-40'
			: ''}">−</a
	>
	<output class="min-w-6 text-center font-semibold" aria-live="polite" data-testid={testId}
		>{value}</output
	>
	<a
		href={hrefFor(value + 1)}
		aria-label="More {label.toLowerCase()}"
		aria-disabled={value >= max}
		class="rounded-lg border border-stone-300 px-2.5 py-1 font-semibold {value >= max
			? 'pointer-events-none opacity-40'
			: ''}">+</a
	>
</div>
