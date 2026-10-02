<script lang="ts">
	import type { ChartStyle } from '#lib/shared/charts.js';
	import { CHART_STYLES } from '#lib/shared/charts.js';

	interface Props {
		/** The chart being shown. */
		current: ChartStyle;
		/** The address of the same person's chart in another style. */
		hrefFor: (style: ChartStyle) => string;
	}

	let { current, hrefFor }: Props = $props();
</script>

<nav aria-label="Chart style" class="flex flex-wrap gap-1 text-sm">
	{#each CHART_STYLES as style (style.id)}
		<a
			href={hrefFor(style.id)}
			aria-current={style.id === current ? 'page' : undefined}
			class="rounded-lg border px-3 py-1 font-semibold {style.id === current
				? 'border-emerald-700 bg-emerald-700 text-white'
				: 'border-stone-300 text-emerald-900 hover:bg-stone-100'}">{style.label}</a
		>
	{/each}
</nav>
