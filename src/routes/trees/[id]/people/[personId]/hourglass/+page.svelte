<script lang="ts">
	import AncestorOutline from '#lib/components/charts/AncestorOutline.svelte';
	import ChartCanvas from '#lib/components/charts/ChartCanvas.svelte';
	import ChartPage from '#lib/components/charts/ChartPage.svelte';
	import DescendantOutline from '#lib/components/charts/DescendantOutline.svelte';
	import GenerationStepper from '#lib/components/charts/GenerationStepper.svelte';
	import { layoutHourglass } from '#lib/charts/chart-layout.js';
	import { MAX_HOURGLASS_GENERATIONS } from '#lib/shared/charts.js';
	import type { PageProps } from './$types';
	import { treePath } from '#lib/shared/tree-slug.js';

	let { data }: PageProps = $props();
	const treeId = $derived(data.summary.tree.id);
	const base = $derived(treePath(data.summary.tree));
	const subject = $derived(data.descendants.root.person);
	const layout = $derived(layoutHourglass(data.ancestors.slots, data.up, data.descendants.root));
	const address = (id: string, up = data.up, down = data.down) =>
		`${base}/people/${encodeURIComponent(id)}/hourglass?up=${up}&down=${down}`;
	const notice = $derived(
		[
			data.ancestors.hasMoreAbove && 'Further ancestors exist beyond the last generation shown.',
			data.descendants.hasMoreBelow && 'Further descendants exist beyond the last generation shown.'
		]
			.filter(Boolean)
			.join(' ') || null
	);
</script>

{#snippet controls()}
	<GenerationStepper
		label="Descendants"
		value={data.down}
		max={MAX_HOURGLASS_GENERATIONS}
		testId="down"
		hrefFor={(n) => address(subject.id, data.up, n)}
	/>
	<GenerationStepper
		label="Ancestors"
		value={data.up}
		max={MAX_HOURGLASS_GENERATIONS}
		testId="up"
		hrefFor={(n) => address(subject.id, n, data.down)}
	/>
{/snippet}

<ChartPage
	{treeId}
	treeSlug={data.summary.tree.slug}
	treeName={data.summary.tree.name}
	{subject}
	style="hourglass"
	heading="Hourglass of {subject.name}"
	hint="Descendants to the left, ancestors to the right."
	generations={data.up}
	{controls}
	{notice}
>
	<ChartCanvas
		{layout}
		label="Hourglass of {subject.name}: {data.down} generations of descendants and {data.up} of ancestors"
		hrefFor={(id) => address(id)}
	/>
</ChartPage>
<DescendantOutline
	root={data.descendants.root}
	hrefFor={(id) => address(id)}
	summary="Descendants as a list"
	testId="descendant-outline"
/>
<AncestorOutline
	slots={data.ancestors.slots}
	hrefFor={(id) => address(id)}
	summary="Ancestors as a list"
/>
