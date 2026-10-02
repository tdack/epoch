<script lang="ts">
	import ChartCanvas from '#lib/components/charts/ChartCanvas.svelte';
	import AncestorOutline from '#lib/components/charts/AncestorOutline.svelte';
	import DescendantOutline from '#lib/components/charts/DescendantOutline.svelte';
	import ChartStyleNav from '#lib/components/charts/ChartStyleNav.svelte';
	import GenerationStepper from '#lib/components/charts/GenerationStepper.svelte';
	import { layoutHourglass } from '#lib/charts/chart-layout.js';
	import { chartAddress, MAX_HOURGLASS_GENERATIONS } from '#lib/shared/charts.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const treeId = $derived(data.summary.tree.id);
	const base = $derived(`/trees/${encodeURIComponent(treeId)}`);
	const subject = $derived(data.descendants.root.person);
	const layout = $derived(layoutHourglass(data.ancestors.slots, data.up, data.descendants.root));
	const address = (id: string, up = data.up, down = data.down) => `${base}/people/${encodeURIComponent(id)}/hourglass?up=${up}&down=${down}`;
</script>

<svelte:head>
	<title>Hourglass of {subject.name} · {data.summary.tree.name} · Epoch</title>
</svelte:head>

<nav aria-label="Breadcrumb" class="text-sm text-stone-600">
	<a href={base} class="font-semibold text-emerald-800 hover:underline">{data.summary.tree.name}</a> /
	<a href="{base}/people/{encodeURIComponent(subject.id)}" class="font-semibold text-emerald-800 hover:underline">{subject.name}</a>
</nav>
<h2 class="mt-1 text-2xl font-bold text-stone-900">Hourglass of {subject.name}</h2>
<p class="mt-1 text-sm text-stone-600">Descendants to the left, ancestors to the right.</p>

<div class="mt-3 flex flex-wrap items-center gap-3 text-sm">
	<ChartStyleNav current="hourglass" hrefFor={(style) => chartAddress(treeId, subject.id, style, data.up)} />
	<GenerationStepper label="Descendants" value={data.down} max={MAX_HOURGLASS_GENERATIONS} testId="down" hrefFor={(n) => address(subject.id, data.up, n)} />
	<GenerationStepper label="Ancestors" value={data.up} max={MAX_HOURGLASS_GENERATIONS} testId="up" hrefFor={(n) => address(subject.id, n, data.down)} />
	<a href="{base}?focus={encodeURIComponent(subject.id)}" class="font-semibold text-emerald-800 hover:underline">Show in the tree</a>
</div>

{#if data.ancestors.hasMoreAbove || data.descendants.hasMoreBelow}
	<p class="mt-2 text-sm text-stone-600" data-testid="more">
		{#if data.ancestors.hasMoreAbove}Further ancestors exist beyond the last generation shown. {/if}{#if data.descendants.hasMoreBelow}Further descendants exist beyond the last generation shown.{/if}
	</p>
{/if}

<div class="mt-4">
	<ChartCanvas {layout} label="Hourglass of {subject.name}: {data.down} generations of descendants and {data.up} of ancestors" hrefFor={(id) => address(id)} />
</div>
<DescendantOutline root={data.descendants.root} hrefFor={(id) => address(id)} summary="Descendants as a list" testId="descendant-outline" />
<AncestorOutline slots={data.ancestors.slots} hrefFor={(id) => address(id)} summary="Ancestors as a list" />
