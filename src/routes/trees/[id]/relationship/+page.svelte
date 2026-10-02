<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import PersonPicker from '#lib/components/PersonPicker.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const treeId = $derived(data.summary.tree.id);
	const base = $derived(`/trees/${encodeURIComponent(treeId)}`);

	type Picked = { id: string; name: string } | null;
	let first = $state<Picked>(untrack(() => (data.result ? { id: data.result.from.id, name: data.result.from.name } : null)));
	let second = $state<Picked>(untrack(() => (data.result ? { id: data.result.to.id, name: data.result.to.name } : null)));

	// Choosing the second person asks the question: the address changes, and the load answers it.
	function ask(a: Picked, b: Picked) {
		if (a && b) void goto(`${base}/relationship?from=${encodeURIComponent(a.id)}&to=${encodeURIComponent(b.id)}`);
	}

	const personPath = (id: string) => `${base}/people/${encodeURIComponent(id)}`;
	const relationText = (relation: string | null, linkType: string | null) => {
		const kind = linkType && linkType !== 'biological' ? `${linkType} ` : '';
		return relation === 'parent' ? `${kind}parent of` : relation === 'child' ? `${kind}child of` : relation === 'partner' ? 'partner of' : '';
	};
</script>

<svelte:head>
	<title>Relationship · {data.summary.tree.name} · Epoch</title>
</svelte:head>

<h2 class="text-2xl font-bold text-stone-900">How are they related?</h2>
<p class="mt-1 max-w-2xl text-sm text-stone-600">Choose two people. Every route between them is listed, nearest first.</p>

<div class="mt-5 flex flex-wrap items-start gap-6">
	<PersonPicker {treeId} label="First person" picked={first} onpick={(p) => { first = p; ask(first, second); }} />
	<PersonPicker {treeId} label="Second person" picked={second} onpick={(p) => { second = p; ask(first, second); }} />
</div>

{#if data.result}
	{@const result = data.result}
	<section class="mt-8 max-w-3xl" aria-live="polite" aria-labelledby="result-heading">
		<h3 id="result-heading" class="sr-only">Result</h3>
		{#if result.routes.length === 0}
			<p class="rounded-xl border border-stone-200 bg-white p-4 text-sm text-stone-700" data-testid="no-relationship">
				{result.isIncomplete
					? 'No relationship was found, but the search stopped at its limit, so they may still be related.'
					: `No relationship between ${result.from.name} and ${result.to.name} is recorded in this tree.`}
			</p>
		{:else}
			<ol class="space-y-4">
				{#each result.routes as route, index (index)}
					<li class="rounded-xl border border-stone-200 bg-white p-4" data-testid="route">
						<p class="text-lg font-semibold text-stone-900" data-testid="route-label">
							{#if route.kind === 'self'}{result.from.name} is the same person.{:else}{result.to.name} is {result.from.name}'s {route.label}.{/if}
						</p>
						{#if route.viaNames.length > 0}<p class="text-sm text-stone-600">Through {route.viaNames.join(' and ')}.</p>{/if}
						{#if route.nonBiologicalTypes.length > 0}<p class="text-sm text-amber-800">Includes {route.nonBiologicalTypes.join(' and ')} links.</p>{/if}
						{#if route.steps.length > 1}
							<ol class="mt-3 space-y-1 border-l-2 border-emerald-200 pl-4 text-sm" aria-label="Steps">
								{#each route.steps as step, i (i)}
									<li>
										{#if step.isPrivate}
											<span class="italic text-stone-500">Private</span>
										{:else}
											<a href={personPath(step.id)} class="font-medium text-emerald-800 underline">{step.name}</a>
										{/if}
										{#if step.relation}<span class="text-stone-500"> — {relationText(step.relation, step.linkType)} {route.steps[i - 1]?.name}</span>{/if}
									</li>
								{/each}
							</ol>
						{/if}
					</li>
				{/each}
			</ol>
		{/if}
	</section>
{/if}
