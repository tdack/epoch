<script lang="ts">
	import type { Snippet } from 'svelte';
	import { chartAddress, type ChartStyle } from '#lib/shared/charts.js';
	import ChartStyleNav from './ChartStyleNav.svelte';
	import GenerationStepper from './GenerationStepper.svelte';

	interface Props {
		treeId: string;
		treeName: string;
		/** Whose chart this is: the breadcrumb and the "Show in the tree" link point at them. */
		subject: { id: string; name: string };
		/** The chart being shown; the style switcher marks it. */
		style: ChartStyle;
		/** The page's heading and tab title, e.g. "Ancestors of Ann Fox". */
		heading: string;
		/** One line under the heading, when the chart needs a hint on how to read it. */
		hint?: string;
		/** The depth the style switcher carries over to the other charts. */
		generations: number;
		/** The single generation control most charts have; ignored when `controls` is given. */
		stepper?: { value: number; max: number; hrefFor: (generations: number) => string };
		/** Replaces the single stepper, for a chart with more than one depth (the hourglass). */
		controls?: Snippet;
		/** Said when the chart stops before the tree does; null when it shows everything. */
		notice?: string | null;
		/** The chart itself and its outline. */
		children: Snippet;
	}

	let {
		treeId,
		treeName,
		subject,
		style,
		heading,
		hint,
		generations,
		stepper,
		controls,
		notice = null,
		children
	}: Props = $props();

	const base = $derived(`/trees/${encodeURIComponent(treeId)}`);
</script>

<svelte:head>
	<title>{heading} · {treeName} · Epoch</title>
</svelte:head>

<nav aria-label="Breadcrumb" class="text-sm text-stone-600">
	<a href={base} class="font-semibold text-emerald-800 hover:underline">{treeName}</a>
	/
	<a
		href="{base}/people/{encodeURIComponent(subject.id)}"
		class="font-semibold text-emerald-800 hover:underline">{subject.name}</a
	>
</nav>
<h2 class="mt-1 text-2xl font-bold text-stone-900">{heading}</h2>
{#if hint}<p class="mt-1 text-sm text-stone-600">{hint}</p>{/if}

<div class="mt-3 flex flex-wrap items-center gap-3 text-sm">
	<ChartStyleNav
		current={style}
		hrefFor={(other) => chartAddress(treeId, subject.id, other, generations)}
	/>
	{#if controls}
		{@render controls()}
	{:else if stepper}
		<GenerationStepper
			label="Generations"
			value={stepper.value}
			max={stepper.max}
			hrefFor={stepper.hrefFor}
		/>
	{/if}
	<a
		href="{base}?focus={encodeURIComponent(subject.id)}"
		class="font-semibold text-emerald-800 hover:underline">Show in the tree</a
	>
</div>

{#if notice}<p class="mt-2 text-sm text-stone-600" data-testid="more">{notice}</p>{/if}

<div class="mt-4">
	{@render children()}
</div>
