<script lang="ts">
	import PrintButton from '#lib/components/layout/PrintButton.svelte';
	import GenerationStepper from '#lib/components/charts/GenerationStepper.svelte';
	import ReportHeader from '#lib/components/reports/ReportHeader.svelte';
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

<ReportHeader
	crumbs={[
		{ label: data.summary.tree.name, href: base },
		{ label: chart.person.name, href: personHref(chart.person.id) }
	]}
	title={heading}
>
	{#snippet summary()}
		How much of {chart.person.name}'s pedigree is recorded, and where it stops.
	{/snippet}
	{#snippet actions()}
		<GenerationStepper
			label="Generations"
			value={chart.generations}
			max={MAX_PEDIGREE_GENERATIONS}
			hrefFor={(n) => `${personHref(chart.person.id)}/gaps?generations=${n}`}
		/>
		<PrintButton />
	{/snippet}
</ReportHeader>

<ResearchGaps {chart} {personHref} />
