<script lang="ts">
	import type { NarrativeDto } from '#lib/shared/reports.js';

	interface Props {
		/** The narrative as the server told it. */
		narrative: NarrativeDto;
		/** The address of a person's page. */
		personHref: (id: string) => string;
		/** Prefixes entry and note ids, so two narratives can share a page (the family book). */
		idPrefix?: string;
		/** Heading level of each generation; entries are one level below and notes share it. */
		level?: 2 | 3;
	}

	let { narrative, personHref, idPrefix = '', level = 2 }: Props = $props();
	const generationNumbers = $derived([...new Set(narrative.entries.map((e) => e.generation))]);
	const heading = $derived(`h${level}`);
	const entryHeading = $derived(`h${level + 1}`);
</script>

{#each generationNumbers as generation (generation)}
	<section aria-labelledby="{idPrefix}generation-{generation}" class="mt-6">
		<svelte:element
			this={heading}
			id="{idPrefix}generation-{generation}"
			class="break-after-avoid text-lg font-bold text-stone-900"
		>
			Generation {generation}
		</svelte:element>
		{#each narrative.entries.filter((e) => e.generation === generation) as entry (entry.number)}
			<article id="{idPrefix}entry-{entry.number}" class="mt-3 max-w-3xl text-sm leading-relaxed">
				<svelte:element this={entryHeading} class="break-after-avoid font-semibold">
					{entry.number}.
					{#if entry.isPrivate}
						<span class="text-stone-600 italic">Private</span>
					{:else}
						<a href={personHref(entry.personId)} class="text-link">{entry.name}</a>
					{/if}
				</svelte:element>
				{#if !entry.isPrivate}
					{#if entry.seeNumber}
						<p>
							See number <a href="#{idPrefix}entry-{entry.seeNumber}" class="text-link"
								>{entry.seeNumber}</a
							>.
						</p>
					{:else}
						<p>
							{#each entry.sentences as sentence, i (i)}{i > 0
									? ' '
									: ''}{sentence.text}{#each sentence.notes as n (n)}<sup
										><a href="#{idPrefix}note-{n}" aria-label="Note {n}" class="text-link">{n}</a
										></sup
									>{/each}{/each}
						</p>
					{/if}
				{/if}
			</article>
		{/each}
	</section>
{/each}

{#if narrative.hasMore}
	<p class="mt-6 text-sm text-stone-600" data-testid="more">
		More generations exist past generation {narrative.generations}.
	</p>
{/if}

{#if narrative.endnotes.length > 0}
	<section aria-labelledby="{idPrefix}endnotes" class="mt-8 border-t border-stone-300 pt-3">
		<svelte:element this={heading} id="{idPrefix}endnotes" class="text-lg font-bold text-stone-900"
			>Notes</svelte:element
		>
		<ol class="mt-2 list-decimal space-y-1 pl-5 text-sm">
			{#each narrative.endnotes as note (note.number)}<li id="{idPrefix}note-{note.number}">
					{note.text}
				</li>{/each}
		</ol>
	</section>
{/if}
