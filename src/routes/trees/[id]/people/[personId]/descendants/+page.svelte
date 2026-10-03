<script lang="ts">
	import ChartCanvas from '#lib/components/charts/ChartCanvas.svelte';
	import ChartPage from '#lib/components/charts/ChartPage.svelte';
	import DescendantOutline from '#lib/components/charts/DescendantOutline.svelte';
	import { layoutDescendants } from '#lib/charts/chart-layout.js';
	import { chartAddress, MAX_DESCENDANT_GENERATIONS } from '#lib/shared/charts.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const treeId = $derived(data.summary.tree.id);
	const subject = $derived(data.chart.root.person);
	const layout = $derived(layoutDescendants(data.chart.root));
	const address = (id: string, generations = data.chart.generations) =>
		chartAddress(treeId, id, 'descendants', generations);
</script>

<ChartPage
	{treeId}
	treeName={data.summary.tree.name}
	{subject}
	style="descendants"
	heading="Descendants of {subject.name}"
	generations={data.chart.generations}
	stepper={{
		value: data.chart.generations,
		max: MAX_DESCENDANT_GENERATIONS,
		hrefFor: (n) => address(subject.id, n)
	}}
	notice={data.chart.hasMoreBelow
		? 'Further descendants exist below the last generation shown. Add a generation to see them.'
		: null}
>
	<ChartCanvas
		{layout}
		label="Descendants of {subject.name}, {data.chart.generations} generations"
		hrefFor={(id) => address(id)}
	/>
</ChartPage>
<DescendantOutline root={data.chart.root} hrefFor={(id) => address(id)} />
