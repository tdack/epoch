<script lang="ts">
	import { treeLinkSlug } from '#lib/shared/tree-slug.js';
	import AncestorOutline from '#lib/components/charts/AncestorOutline.svelte';
	import ChartPage from '#lib/components/charts/ChartPage.svelte';
	import FanChart from '#lib/components/charts/FanChart.svelte';
	import { layoutFan, MAX_FAN_GENERATIONS } from '#lib/charts/fan-layout.js';
	import { chartAddress } from '#lib/shared/charts.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const treeId = $derived(data.summary.tree.id);
	const subject = $derived(data.chart.person);
	const layout = $derived(layoutFan(data.chart.slots, data.chart.generations));
	const address = (id: string, generations = data.chart.generations) =>
		chartAddress(data.summary.tree, id, 'fan', generations);
</script>

<ChartPage
	{treeId}
	treeSlug={treeLinkSlug(data.summary.tree)}
	treeName={data.summary.tree.name}
	{subject}
	style="fan"
	heading="Fan chart of {subject.name}"
	generations={data.chart.generations}
	stepper={{
		value: data.chart.generations,
		max: MAX_FAN_GENERATIONS,
		hrefFor: (n) => address(subject.id, n)
	}}
	notice={data.chart.hasMoreAbove
		? 'Further ancestors exist beyond the outer ring. Add a generation to see them.'
		: null}
>
	<FanChart
		{layout}
		label="Fan chart of {subject.name}, {data.chart.generations} generations"
		hrefFor={(id) => address(id)}
	/>
</ChartPage>
<AncestorOutline slots={data.chart.slots} hrefFor={(id) => address(id)} />
