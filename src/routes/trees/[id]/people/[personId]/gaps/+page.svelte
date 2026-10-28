<script lang="ts">
	import PrintButton from '#lib/components/layout/PrintButton.svelte';
	import GenerationStepper from '#lib/components/charts/GenerationStepper.svelte';
	import ResearchGaps from '#lib/components/reports/ResearchGaps.svelte';
	import { MAX_PEDIGREE_GENERATIONS } from '#lib/shared/charts.js';
	import { treePath } from '#lib/shared/tree-slug.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const chart = $derived(data.chart);
	const base = $derived(treePath(data.summary.tree));
	const personHref = (id: string) => `${base}/people/${encodeURIComponent(id)}`;
	const heading = $derived(`Research gaps for ${chart.person.name}`);
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
	<PrintButton />
</div>

<ResearchGaps {chart} {personHref} />
