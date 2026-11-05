<script lang="ts">
	import { ArrowLeftRight, FileText, GitBranch } from '@lucide/svelte';
	import { CHART_ICONS } from '#lib/components/charts/chart-icons.js';
	import { CHART_STYLES } from '#lib/shared/charts.js';
	import { personPath, treePath } from './person-paths.js';

	interface Props {
		personId: string;
		treeId: string;
		/** The tree's slug, for the links this builds (ADR-045); without one they use the id. */
		treeSlug?: string | null;
	}

	let { personId, treeId, treeSlug = null }: Props = $props();

	const treeRef = $derived({ id: treeId, slug: treeSlug });
	const treeHref = $derived(treePath(treeRef));
	const here = $derived(personPath(treeRef, personId));
	const focus = $derived(encodeURIComponent(personId));

	const link =
		'row-link inline-flex items-center gap-2 rounded-lg text-sm focus-ring coarse:min-h-11';
</script>

<!-- Links, not buttons: each view is its own address, so it opens in a new tab or is shared. -->
<nav aria-label="Charts and views" class="space-y-3">
	<a href={`${treeHref}?focus=${focus}`} class={link}
		><GitBranch class="h-4 w-4 shrink-0" aria-hidden="true" />Show in the tree</a
	>
	<ul class="grid grid-cols-2 gap-x-4 gap-y-2">
		{#each CHART_STYLES as style (style.id)}
			{@const Icon = CHART_ICONS[style.id]}
			<li>
				<a href={`${here}/${style.path}`} class={link}
					><Icon class="h-4 w-4 shrink-0" aria-hidden="true" />{style.label}</a
				>
			</li>
		{/each}
	</ul>
	<!-- Tools rather than views: one asks for a second person, the other opens the tree's reports. -->
	<ul class="flex flex-wrap gap-x-4 gap-y-2 border-t border-stone-200 pt-3">
		<li>
			<a href={`${treeHref}/relationship?from=${focus}`} class={link}
				><ArrowLeftRight class="h-4 w-4 shrink-0" aria-hidden="true" />Relationship to…</a
			>
		</li>
		<li>
			<a href={`${treeHref}/reports?focus=${focus}`} class={link}
				><FileText class="h-4 w-4 shrink-0" aria-hidden="true" />Reports</a
			>
		</li>
	</ul>
</nav>
