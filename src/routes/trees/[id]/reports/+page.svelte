<script lang="ts">
	import { untrack } from 'svelte';
	import PersonPicker from '#lib/components/PersonPicker.svelte';
	import { chartAddress } from '#lib/shared/charts.js';
	import { DEFAULT_NARRATIVE_GENERATIONS, NARRATIVE_KINDS } from '#lib/shared/reports.js';
	import { treePath } from '#lib/shared/tree-slug.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const treeId = $derived(data.summary.tree.id);
	const base = $derived(treePath(data.summary.tree));

	let picked = $state<{ id: string; name: string } | null>(untrack(() => data.me));
	const personBase = (id: string) => `${base}/people/${encodeURIComponent(id)}`;
	const narrative = (id: string, kind: string) =>
		`${personBase(id)}/narrative?kind=${kind}&generations=${DEFAULT_NARRATIVE_GENERATIONS}`;
	// Tasks and Quality are members' working screens, which the Research menu hides from outsiders.
	const acrossTheTree = $derived([
		...(data.summary.viewer.isOutsider
			? []
			: [
					{
						href: `${base}/quality`,
						label: 'Quality',
						hint: 'Findings to check, such as dates that disagree.'
					},
					{ href: `${base}/tasks`, label: 'Tasks', hint: 'Research to do, by person and status.' }
				]),
		{
			href: `${base}/places`,
			label: 'Places',
			hint: 'Every place, and the people and events at each.'
		},
		{ href: `${base}/sources`, label: 'Sources', hint: 'Every source, and what it supports.' }
	]);
</script>

<svelte:head>
	<title>Reports · {data.summary.tree.name} · Epoch</title>
</svelte:head>

<h1 class="text-2xl font-bold text-stone-900">Reports</h1>
<p class="mt-1 max-w-2xl text-sm text-stone-600">
	Each report reads from the tree as you may see it, so a printout never shows more than the screen.
</p>

<div class="mt-5 max-w-2xl space-y-4">
	<section aria-labelledby="about-person" class="section-card">
		<h2 id="about-person" class="section-heading">About a person</h2>
		<div class="mt-2">
			<PersonPicker {treeId} label="Person" {picked} onpick={(p) => (picked = p)} />
		</div>
		{#if picked}
			<ul class="mt-3 space-y-1.5 text-sm" data-testid="person-reports">
				<li>
					<a class="text-link" href={personBase(picked.id)}>Individual summary</a>
					<span class="text-stone-600"> · print it from your browser</span>
				</li>
				<li>
					<a class="text-link" href={chartAddress(data.summary.tree, picked.id, 'pedigree', 4)}
						>Ancestors chart</a
					>
				</li>
				<li>
					<a class="text-link" href={chartAddress(data.summary.tree, picked.id, 'descendants', 3)}
						>Descendants chart</a
					>
				</li>
				<li>
					<a class="text-link" href={narrative(picked.id, NARRATIVE_KINDS.ANCESTORS)}
						>Ancestor narrative</a
					>
				</li>
				<li>
					<a class="text-link" href={narrative(picked.id, NARRATIVE_KINDS.DESCENDANTS)}
						>Descendant narrative</a
					>
				</li>
			</ul>
		{/if}
	</section>

	<section aria-labelledby="about-partnership" class="section-card">
		<h2 id="about-partnership" class="section-heading">About a partnership</h2>
		<p class="mt-2 text-sm text-stone-700">
			A family group sheet lists a partnership's partners, their parents and the children. Open a
			partnership, then choose Family group sheet.
		</p>
		<p class="mt-2 text-sm"><a class="text-link" href="{base}/unions">Partnerships</a></p>
	</section>

	<section aria-labelledby="across-tree" class="section-card">
		<h2 id="across-tree" class="section-heading">Across the tree</h2>
		<ul class="mt-2 space-y-1.5 text-sm">
			{#each acrossTheTree as link (link.href)}
				<li>
					<a class="text-link" href={link.href}>{link.label}</a>
					<span class="text-stone-600"> · {link.hint}</span>
				</li>
			{/each}
		</ul>
	</section>

	<section aria-labelledby="coming-later" class="section-card">
		<h2 id="coming-later" class="section-heading">Coming later</h2>
		<p class="mt-2 text-sm text-stone-700">
			A calendar, a kinship list, an interview sheet, brick walls and a family book.
		</p>
	</section>
</div>
