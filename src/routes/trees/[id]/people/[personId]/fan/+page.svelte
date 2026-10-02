<script lang="ts">
	import AncestorOutline from '#lib/components/charts/AncestorOutline.svelte';
	import ChartStyleNav from '#lib/components/charts/ChartStyleNav.svelte';
	import FanChart from '#lib/components/charts/FanChart.svelte';
	import GenerationStepper from '#lib/components/charts/GenerationStepper.svelte';
	import { layoutFan, MAX_FAN_GENERATIONS } from '#lib/charts/fan-layout.js';
	import { chartAddress } from '#lib/shared/charts.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const treeId = $derived(data.summary.tree.id);
	const base = $derived(`/trees/${encodeURIComponent(treeId)}`);
	const subject = $derived(data.chart.person);
	const layout = $derived(layoutFan(data.chart.slots, data.chart.generations));
	const address = (id: string, generations = data.chart.generations) =>
		chartAddress(treeId, id, 'fan', generations);
</script>

<svelte:head>
	<title>Fan chart of {subject.name} · {data.summary.tree.name} · Epoch</title>
</svelte:head>

<nav aria-label="Breadcrumb" class="text-sm text-stone-600">
	<a href={base} class="font-semibold text-emerald-800 hover:underline">{data.summary.tree.name}</a>
	/
	<a
		href="{base}/people/{encodeURIComponent(subject.id)}"
		class="font-semibold text-emerald-800 hover:underline">{subject.name}</a
	>
</nav>
<h2 class="mt-1 text-2xl font-bold text-stone-900">Fan chart of {subject.name}</h2>

<div class="mt-3 flex flex-wrap items-center gap-3 text-sm">
	<ChartStyleNav
		current="fan"
		hrefFor={(style) => chartAddress(treeId, subject.id, style, data.chart.generations)}
	/>
	<GenerationStepper
		label="Generations"
		value={data.chart.generations}
		max={MAX_FAN_GENERATIONS}
		hrefFor={(n) => address(subject.id, n)}
	/>
	<a
		href="{base}?focus={encodeURIComponent(subject.id)}"
		class="font-semibold text-emerald-800 hover:underline">Show in the tree</a
	>
</div>

{#if data.chart.hasMoreAbove}<p class="mt-2 text-sm text-stone-600" data-testid="more">
		Further ancestors exist beyond the outer ring. Add a generation to see them.
	</p>{/if}

<div class="mt-4">
	<FanChart
		{layout}
		label="Fan chart of {subject.name}, {data.chart.generations} generations"
		hrefFor={(id) => address(id)}
	/>
</div>
<AncestorOutline slots={data.chart.slots} hrefFor={(id) => address(id)} />
