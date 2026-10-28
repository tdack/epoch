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
		/**
		 * Where the first person's own story is already told on this page, so their entry points
		 * there instead of repeating it (the family book's descendants part).
		 */
		rootToldAt?: { label: string; href: string } | null;
	}

	let { narrative, personHref, idPrefix = '', level = 2, rootToldAt = null }: Props = $props();
	const generationNumbers = $derived([...new Set(narrative.entries.map((e) => e.generation))]);
	const heading = $derived(`h${level}`);
	const entryHeading = $derived(`h${level + 1}`);
</script>

{#each generationNumbers as generation (generation)}
	<section aria-labelledby="{idPrefix}generation-{generation}" class="mt-8">
		<svelte:element
			this={heading}
			id="{idPrefix}generation-{generation}"
			class="section-heading max-w-2xl break-after-avoid border-b border-stone-200 pb-1.5 print:border-stone-400"
		>
			Generation {generation}
		</svelte:element>
		{#each narrative.entries.filter((e) => e.generation === generation) as entry (entry.number)}
			{@const isFolded = rootToldAt !== null && entry.generation === 1}
			<article
				id="{idPrefix}entry-{entry.number}"
				class="mt-4 max-w-2xl scroll-mt-32 text-sm/relaxed text-stone-800"
			>
				<svelte:element this={entryHeading} class="break-after-avoid">
					<span class="mr-1 font-semibold text-stone-500 tabular-nums">{entry.number}.</span>
					{#if entry.isPrivate}
						<span class="text-stone-600 italic">Private</span>
					{:else}
						<a href={personHref(entry.personId)} class="text-link">{entry.name}</a>
					{/if}
				</svelte:element>
				{#if !entry.isPrivate}
					{#if isFolded && rootToldAt}
						<p class="mt-0.5 text-stone-600">
							Told under <a href={rootToldAt.href} class="text-link">{rootToldAt.label}</a>; the
							children follow.
						</p>
					{:else if entry.seeNumber}
						<p class="mt-0.5 text-stone-600">
							See number <a href="#{idPrefix}entry-{entry.seeNumber}" class="text-link"
								>{entry.seeNumber}</a
							>.
						</p>
					{:else}
						<p class="mt-0.5 text-pretty">
							{#each entry.sentences as sentence, i (i)}{i > 0
									? ' '
									: ''}{sentence.text}{#each sentence.notes as n (n)}<sup
										><a
											href="#{idPrefix}note-{n}"
											aria-label="Note {n}"
											class="text-link ml-px text-xs">{n}</a
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
	<p class="mt-8 max-w-2xl text-sm text-stone-600" data-testid="more">
		More generations exist past generation {narrative.generations}.
	</p>
{/if}

{#if narrative.endnotes.length > 0}
	<section aria-labelledby="{idPrefix}endnotes" class="mt-10 max-w-2xl">
		<svelte:element
			this={heading}
			id="{idPrefix}endnotes"
			class="section-heading border-b border-stone-200 pb-1.5 print:border-stone-400"
			>Notes</svelte:element
		>
		<ol class="mt-3 space-y-1 text-xs/relaxed text-stone-700">
			{#each narrative.endnotes as note (note.number)}<li
					id="{idPrefix}note-{note.number}"
					class="grid scroll-mt-32 grid-cols-[2rem_1fr]"
				>
					<span class="text-right font-semibold text-stone-500 tabular-nums">{note.number}.</span
					><span class="pl-2">{note.text}</span>
				</li>{/each}
		</ol>
	</section>
{/if}
