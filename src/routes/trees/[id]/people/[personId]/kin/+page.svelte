<script lang="ts">
	import GenerationStepper from '#lib/components/charts/GenerationStepper.svelte';
	import { dateReader } from '#lib/components/date-format.js';
	import { MAX_KIN_LIST_GENERATIONS } from '#lib/shared/kinship.js';
	import { treePath } from '#lib/shared/tree-slug.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const kin = $derived(data.kin);
	const base = $derived(treePath(data.summary.tree));
	const date = dateReader();
	const personHref = (id: string) => `${base}/people/${encodeURIComponent(id)}`;
	const heading = $derived(`Relatives of ${kin.person.name}`);
</script>

<svelte:head>
	<title>{heading} · {data.summary.tree.name} · Epoch</title>
</svelte:head>

<nav aria-label="Breadcrumb" class="text-sm text-stone-600 print:hidden">
	<a href={base} class="text-link">{data.summary.tree.name}</a> /
	<a href={personHref(kin.person.id)} class="text-link">{kin.person.name}</a>
</nav>
<h1 class="mt-1 text-2xl font-bold text-stone-900">{heading}</h1>
<p class="mt-1 max-w-2xl text-sm text-stone-600">
	Everyone you can see who descends from {kin.person.name}'s ancestors up to {kin.generations}
	{kin.generations === 1 ? 'generation' : 'generations'} back, and their partners, nearest first.
</p>

<div class="mt-3 flex flex-wrap items-center gap-3 text-sm print:hidden">
	<GenerationStepper
		label="Generations back"
		value={kin.generations}
		max={MAX_KIN_LIST_GENERATIONS}
		hrefFor={(n) => `${personHref(kin.person.id)}/kin?generations=${n}`}
	/>
	<button type="button" class="action-btn" onclick={() => window.print()}>Print</button>
</div>

{#if kin.entries.length === 0}
	<p class="mt-5 text-sm text-stone-600">No relatives are recorded within these generations.</p>
{:else}
	<table class="mt-5 w-full max-w-3xl text-left text-sm" data-testid="kin-list">
		<caption class="sr-only">{heading}</caption>
		<thead class="border-b border-stone-300 text-stone-600">
			<tr>
				<th scope="col" class="py-1.5 pr-3 font-semibold">Name</th>
				<th scope="col" class="py-1.5 pr-3 font-semibold">Relationship</th>
				<th scope="col" class="py-1.5 pr-3 font-semibold">Born</th>
				<th scope="col" class="py-1.5 font-semibold">Died</th>
			</tr>
		</thead>
		<tbody>
			{#each kin.entries as entry (entry.id)}
				<tr class="break-inside-avoid border-b border-stone-200">
					<th scope="row" class="py-1.5 pr-3 font-normal">
						<a class="text-link" href={personHref(entry.id)}>{entry.name}</a>
					</th>
					<td class="py-1.5 pr-3">{entry.label}</td>
					<td class="py-1.5 pr-3">{date(entry.birth)}</td>
					<td class="py-1.5">{date(entry.death)}</td>
				</tr>
			{/each}
		</tbody>
	</table>
{/if}
{#if kin.isIncomplete}
	<p class="mt-3 text-sm text-stone-600">
		The tree goes on past these generations, so more relatives may be recorded.
	</p>
{/if}
