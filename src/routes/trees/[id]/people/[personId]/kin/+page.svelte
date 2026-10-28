<script lang="ts">
	import PrintButton from '#lib/components/layout/PrintButton.svelte';
	import GenerationStepper from '#lib/components/charts/GenerationStepper.svelte';
	import ReportHeader from '#lib/components/reports/ReportHeader.svelte';
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

<ReportHeader
	crumbs={[
		{ label: data.summary.tree.name, href: base },
		{ label: kin.person.name, href: personHref(kin.person.id) }
	]}
	title={heading}
>
	{#snippet summary()}
		Everyone you can see who descends from {kin.person.name}'s ancestors up to {kin.generations}
		{kin.generations === 1 ? 'generation' : 'generations'} back, and their partners, nearest first.
	{/snippet}
	{#snippet actions()}
		<GenerationStepper
			label="Generations back"
			value={kin.generations}
			max={MAX_KIN_LIST_GENERATIONS}
			hrefFor={(n) => `${personHref(kin.person.id)}/kin?generations=${n}`}
		/>
		<PrintButton />
	{/snippet}
</ReportHeader>

{#if kin.entries.length === 0}
	<p class="mt-5 text-sm text-stone-600">No relatives are recorded within these generations.</p>
{:else}
	<div class="report-panel mt-5 max-w-4xl">
		<table class="report-table" data-testid="kin-list">
			<caption class="sr-only">{heading}</caption>
			<thead>
				<tr>
					<th scope="col">Name</th>
					<th scope="col">Relationship</th>
					<th scope="col">Born</th>
					<th scope="col">Died</th>
				</tr>
			</thead>
			<tbody>
				{#each kin.entries as entry (entry.id)}
					<tr>
						<th scope="row">
							<a class="text-link" href={personHref(entry.id)}>{entry.name}</a>
						</th>
						<td>{entry.label}</td>
						<td class="whitespace-nowrap">{date(entry.birth)}</td>
						<td class="whitespace-nowrap">{date(entry.death)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
{#if kin.isIncomplete}
	<p class="mt-3 text-sm text-stone-600">
		The tree goes on past these generations, so more relatives may be recorded.
	</p>
{/if}
