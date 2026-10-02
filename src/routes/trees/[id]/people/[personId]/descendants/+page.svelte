<script lang="ts">
	import ChartCanvas from '#lib/components/charts/ChartCanvas.svelte';
	import DescendantOutline from '#lib/components/charts/DescendantOutline.svelte';
	import ChartStyleNav from '#lib/components/charts/ChartStyleNav.svelte';
	import GenerationStepper from '#lib/components/charts/GenerationStepper.svelte';
	import { layoutDescendants } from '#lib/charts/chart-layout.js';
	import { chartAddress, MAX_DESCENDANT_GENERATIONS } from '#lib/shared/charts.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const treeId = $derived(data.summary.tree.id);
	const base = $derived(`/trees/${encodeURIComponent(treeId)}`);
	const subject = $derived(data.chart.root.person);
	const layout = $derived(layoutDescendants(data.chart.root));
	const address = (id: string, generations = data.chart.generations) =>
		chartAddress(treeId, id, 'descendants', generations);
</script>

<svelte:head>
	<title>Descendants of {subject.name} · {data.summary.tree.name} · Epoch</title>
</svelte:head>

<nav aria-label="Breadcrumb" class="text-sm text-stone-600">
	<a href={base} class="font-semibold text-emerald-800 hover:underline">{data.summary.tree.name}</a>
	/
	<a
		href="{base}/people/{encodeURIComponent(subject.id)}"
		class="font-semibold text-emerald-800 hover:underline">{subject.name}</a
	>
</nav>
<h2 class="mt-1 text-2xl font-bold text-stone-900">Descendants of {subject.name}</h2>

<div class="mt-3 flex flex-wrap items-center gap-3 text-sm">
	<ChartStyleNav
		current="descendants"
		hrefFor={(style) => chartAddress(treeId, subject.id, style, data.chart.generations)}
	/>
	<GenerationStepper
		label="Generations"
		value={data.chart.generations}
		max={MAX_DESCENDANT_GENERATIONS}
		hrefFor={(n) => address(subject.id, n)}
	/>
	<a
		href="{base}?focus={encodeURIComponent(subject.id)}"
		class="font-semibold text-emerald-800 hover:underline">Show in the tree</a
	>
</div>

{#if data.chart.hasMoreBelow}<p class="mt-2 text-sm text-stone-600" data-testid="more">
		Further descendants exist below the last generation shown. Add a generation to see them.
	</p>{/if}

<div class="mt-4">
	<ChartCanvas
		{layout}
		label="Descendants of {subject.name}, {data.chart.generations} generations"
		hrefFor={(id) => address(id)}
	/>
</div>
<DescendantOutline root={data.chart.root} hrefFor={(id) => address(id)} />
