<script lang="ts">
	import ChartCanvas from '#lib/components/charts/ChartCanvas.svelte';
	import { layoutDescendants } from '#lib/charts/chart-layout.js';
	import { MAX_DESCENDANT_GENERATIONS } from '#lib/shared/charts.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const treeId = $derived(data.summary.tree.id);
	const base = $derived(`/trees/${encodeURIComponent(treeId)}`);
	const subject = $derived(data.chart.root.person);
	const layout = $derived(layoutDescendants(data.chart.root));
	const chartHref = (id: string, generations = data.chart.generations) => `${base}/people/${encodeURIComponent(id)}/descendants?generations=${generations}`;
</script>

<svelte:head>
	<title>Descendants of {subject.name} · {data.summary.tree.name} · Epoch</title>
</svelte:head>

<nav aria-label="Breadcrumb" class="text-sm text-stone-600">
	<a href={base} class="font-semibold text-emerald-800 hover:underline">{data.summary.tree.name}</a> /
	<a href="{base}/people/{encodeURIComponent(subject.id)}" class="font-semibold text-emerald-800 hover:underline">{subject.name}</a>
</nav>
<h2 class="mt-1 text-2xl font-bold text-stone-900">Descendants of {subject.name}</h2>

<div class="mt-3 flex flex-wrap items-center gap-3 text-sm">
	<span class="font-semibold text-stone-700" id="generations-label">Generations</span>
	<div role="group" aria-labelledby="generations-label" class="flex items-center gap-1">
		<a href={chartHref(subject.id, data.chart.generations - 1)} aria-label="Fewer generations" aria-disabled={data.chart.generations <= 1} class="rounded-lg border border-stone-300 px-2.5 py-1 font-semibold {data.chart.generations <= 1 ? 'pointer-events-none opacity-40' : ''}">−</a>
		<output class="min-w-6 text-center font-semibold" aria-live="polite" data-testid="generations">{data.chart.generations}</output>
		<a href={chartHref(subject.id, data.chart.generations + 1)} aria-label="More generations" aria-disabled={data.chart.generations >= MAX_DESCENDANT_GENERATIONS} class="rounded-lg border border-stone-300 px-2.5 py-1 font-semibold {data.chart.generations >= MAX_DESCENDANT_GENERATIONS ? 'pointer-events-none opacity-40' : ''}">+</a>
	</div>
	<a href="{base}/people/{encodeURIComponent(subject.id)}/pedigree?generations={data.chart.generations}" class="font-semibold text-emerald-800 hover:underline">Ancestors chart</a>
	<a href="{base}?focus={encodeURIComponent(subject.id)}" class="font-semibold text-emerald-800 hover:underline">Show in the tree</a>
</div>

{#if data.chart.hasMoreBelow}<p class="mt-2 text-sm text-stone-600" data-testid="more">Further descendants exist below the last generation shown. Add a generation to see them.</p>{/if}

<div class="mt-4">
	<ChartCanvas {layout} label="Descendants of {subject.name}, {data.chart.generations} generations" hrefFor={(id) => chartHref(id)} />
</div>
