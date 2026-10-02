<script lang="ts">
	import type { ChartPerson, DescendantNode } from '#lib/shared/charts.js';

	interface Props {
		/** The person whose descendants are listed; children nest under their parent. */
		root: DescendantNode;
		/** Where a name leads: the chart of that person. Not called for a "Private" entry. */
		hrefFor: (personId: string) => string;
		/** The disclosure's label; the hourglass shows two lists on one page and needs them told apart. */
		summary?: string;
		/** Test hook; the hourglass has two lists. */
		testId?: string;
	}

	let { root, hrefFor, summary = 'The same descendants as a list', testId = 'descendant-outline' }: Props = $props();

	const dates = (birth: string | null, death: string | null) => (birth || death ? `${birth ?? '?'} – ${death ?? ''}`.trim() : '');
</script>

{#snippet name(person: ChartPerson)}
	{#if person.isPrivate}
		<span class="italic text-stone-500">Private</span>
	{:else}
		<a href={hrefFor(person.id)} class="font-medium text-emerald-900 hover:underline">{person.name}</a>
	{/if}
{/snippet}

{#snippet branch(node: DescendantNode)}
	<li>
		{@render name(node.person)}
		<span class="text-stone-600">{dates(node.person.birth, node.person.death)}</span>
		{#if node.partners.length > 0}
			<span class="text-xs text-stone-500">with {#each node.partners as partner, i (partner.id)}{i > 0 ? ', ' : ''}{@render name(partner)}{/each}</span>
		{/if}
		{#if node.children.length > 0}
			<!-- Keyed by position: cousins who marry put one person under two parents. -->
			<ul class="ml-5 mt-1 list-disc space-y-1">
				{#each node.children as child, i (i)}{@render branch(child)}{/each}
			</ul>
		{/if}
	</li>
{/snippet}

<details class="mt-4 rounded-xl border border-stone-200 bg-white p-3 text-sm" data-testid={testId}>
	<summary class="cursor-pointer font-semibold text-stone-800">{summary}</summary>
	<p class="mt-2 text-xs text-stone-600">Each person's children are listed under them.</p>
	<ul class="mt-2 space-y-1">{@render branch(root)}</ul>
</details>
