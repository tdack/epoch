<script lang="ts">
	import GenerationStepper from '#lib/components/charts/GenerationStepper.svelte';
	import {
		DESCENDANT_NUMBERING_LABELS,
		DESCENDANT_NUMBERINGS,
		type DescendantNumbering
	} from '#lib/shared/descendant-numbers.js';
	import {
		MAX_NARRATIVE_GENERATIONS,
		NARRATIVE_KINDS,
		type NarrativeKind
	} from '#lib/shared/reports.js';
	import { treePath } from '#lib/shared/tree-slug.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const dto = $derived(data.narrative);
	const base = $derived(treePath(data.summary.tree));
	const personHref = (id: string) => `${base}/people/${encodeURIComponent(id)}`;
	const numbering = $derived(dto.numbering ?? DESCENDANT_NUMBERINGS.DABOVILLE);
	const address = (kind: NarrativeKind, generations: number, how: DescendantNumbering) =>
		`${personHref(dto.person.id)}/narrative?kind=${kind}&generations=${generations}&numbering=${how}`;
	const heading = $derived(
		`${dto.kind === NARRATIVE_KINDS.ANCESTORS ? 'Ancestors' : 'Descendants'} of ${dto.person.name}`
	);
	const generationNumbers = $derived([...new Set(dto.entries.map((e) => e.generation))]);
	const numberingId = $props.id();
</script>

<svelte:head>
	<title>{heading} · {data.summary.tree.name} · Epoch</title>
</svelte:head>

<nav aria-label="Breadcrumb" class="text-sm text-stone-600 print:hidden">
	<a href={base} class="text-link">{data.summary.tree.name}</a> /
	<a href={personHref(dto.person.id)} class="text-link">{dto.person.name}</a>
</nav>
<h1 class="mt-1 text-2xl font-bold text-stone-900">{heading}</h1>

<div class="mt-3 flex flex-wrap items-center gap-3 text-sm print:hidden">
	<nav aria-label="Narrative kind" class="flex gap-1">
		{#each Object.values(NARRATIVE_KINDS) as kind (kind)}
			<a
				href={address(kind, dto.generations, numbering)}
				aria-current={kind === dto.kind ? 'page' : undefined}
				class="rounded-lg border border-stone-300 px-2.5 py-1 font-semibold {kind === dto.kind
					? 'bg-emerald-800 text-white'
					: ''}">{kind === NARRATIVE_KINDS.ANCESTORS ? 'Ancestors' : 'Descendants'}</a
			>
		{/each}
	</nav>
	<GenerationStepper
		label="Generations"
		value={dto.generations}
		max={MAX_NARRATIVE_GENERATIONS}
		hrefFor={(n) => address(dto.kind, n, numbering)}
	/>
	{#if dto.kind === NARRATIVE_KINDS.DESCENDANTS}
		<!-- A plain form: the choice lives in the address like the other controls. -->
		<form method="get" class="flex items-center gap-2">
			<input type="hidden" name="kind" value={dto.kind} />
			<input type="hidden" name="generations" value={dto.generations} />
			<label for={numberingId} class="font-semibold text-stone-700">Numbering</label>
			<select
				id={numberingId}
				name="numbering"
				class="field-input w-auto"
				value={numbering}
				onchange={(e) => e.currentTarget.form?.requestSubmit()}
			>
				{#each Object.values(DESCENDANT_NUMBERINGS) as value (value)}
					<option {value}>{DESCENDANT_NUMBERING_LABELS[value]}</option>
				{/each}
			</select>
			<noscript><button type="submit" class="action-btn">Apply</button></noscript>
		</form>
	{/if}
	<button type="button" class="action-btn" onclick={() => window.print()}>Print</button>
</div>

{#each generationNumbers as generation (generation)}
	<section aria-labelledby="generation-{generation}" class="mt-6">
		<h2 id="generation-{generation}" class="break-after-avoid text-lg font-bold text-stone-900">
			Generation {generation}
		</h2>
		{#each dto.entries.filter((e) => e.generation === generation) as entry (entry.number)}
			<article id="entry-{entry.number}" class="mt-3 max-w-3xl text-sm leading-relaxed">
				<h3 class="break-after-avoid font-semibold">
					{entry.number}.
					{#if entry.isPrivate}
						<span class="text-stone-600 italic">Private</span>
					{:else}
						<a href={personHref(entry.personId)} class="text-link">{entry.name}</a>
					{/if}
				</h3>
				{#if !entry.isPrivate}
					{#if entry.seeNumber}
						<p>
							See number <a href="#entry-{entry.seeNumber}" class="text-link">{entry.seeNumber}</a>.
						</p>
					{:else}
						<p>
							{#each entry.sentences as sentence, i (i)}{i > 0
									? ' '
									: ''}{sentence.text}{#each sentence.notes as n (n)}<sup
										><a href="#note-{n}" aria-label="Note {n}" class="text-link">{n}</a></sup
									>{/each}{/each}
						</p>
					{/if}
				{/if}
			</article>
		{/each}
	</section>
{/each}

{#if dto.hasMore}
	<p class="mt-6 text-sm text-stone-600" data-testid="more">
		More generations exist past generation {dto.generations}. Add a generation to read them.
	</p>
{/if}

{#if dto.endnotes.length > 0}
	<section aria-labelledby="endnotes" class="mt-8 border-t border-stone-300 pt-3">
		<h2 id="endnotes" class="text-lg font-bold text-stone-900">Notes</h2>
		<ol class="mt-2 list-decimal space-y-1 pl-5 text-sm">
			{#each dto.endnotes as note (note.number)}<li id="note-{note.number}">{note.text}</li>{/each}
		</ol>
	</section>
{/if}
