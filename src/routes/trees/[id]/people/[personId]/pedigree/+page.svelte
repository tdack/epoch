<script lang="ts">
	import AncestorOutline from '#lib/components/charts/AncestorOutline.svelte';
	import ChartCanvas from '#lib/components/charts/ChartCanvas.svelte';
	import ChartPage from '#lib/components/charts/ChartPage.svelte';
	import { layoutPedigree } from '#lib/charts/chart-layout.js';
	import { chartAddress, MAX_PEDIGREE_GENERATIONS } from '#lib/shared/charts.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const treeId = $derived(data.summary.tree.id);
	const subject = $derived(data.chart.person);
	const layout = $derived(layoutPedigree(data.chart.slots, data.chart.generations));
	const address = (id: string, generations = data.chart.generations) =>
		chartAddress(data.summary.tree, id, 'pedigree', generations);
</script>

<ChartPage
	{treeId}
	treeSlug={data.summary.tree.slug}
	treeName={data.summary.tree.name}
	{subject}
	style="pedigree"
	heading="Ancestors of {subject.name}"
	generations={data.chart.generations}
	stepper={{
		value: data.chart.generations,
		max: MAX_PEDIGREE_GENERATIONS,
		hrefFor: (n) => address(subject.id, n)
	}}
	notice={data.chart.hasMoreAbove
		? 'Further ancestors exist above the last generation shown. Add a generation to see them.'
		: null}
>
	<ChartCanvas
		{layout}
		label="Ancestors of {subject.name}, {data.chart.generations} generations"
		hrefFor={(id) => address(id)}
	/>
</ChartPage>
<AncestorOutline slots={data.chart.slots} hrefFor={(id) => address(id)} />
