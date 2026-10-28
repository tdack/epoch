<script lang="ts">
	import PrintButton from '#lib/components/layout/PrintButton.svelte';
	import NarrativeBody from '#lib/components/reports/NarrativeBody.svelte';
	import ResearchGaps from '#lib/components/reports/ResearchGaps.svelte';
	import {
		BOOK_SECTION_LABELS,
		BOOK_SECTIONS,
		MAX_NARRATIVE_GENERATIONS,
		type BookSection,
		type NarrativeDto
	} from '#lib/shared/reports.js';
	import { treePath } from '#lib/shared/tree-slug.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const book = $derived(data.book);
	const subject = $derived(book.pedigree.person);
	const base = $derived(treePath(data.summary.tree));
	const personHref = (id: string) => `${base}/people/${encodeURIComponent(id)}`;
	const heading = $derived(`The family of ${subject.name}`);
	const has = (section: BookSection) => book.sections.includes(section);
	const formId = $props.id();

	const PARTS = [
		{ section: BOOK_SECTIONS.ANCESTORS, prefix: 'a-', mark: 'A' },
		{ section: BOOK_SECTIONS.DESCENDANTS, prefix: 'd-', mark: 'D' }
	] as const;
	const narrativeOf = (section: BookSection): NarrativeDto | null =>
		section === BOOK_SECTIONS.ANCESTORS ? book.ancestors : book.descendants;

	// shortcut: sorts on the last word of the display name, which misfiles "Jr." and particles; upgrade with a surname field on the entry.
	const index = $derived.by(() => {
		const byName = new Map<string, Array<{ label: string; href: string }>>();
		for (const part of PARTS) {
			for (const entry of narrativeOf(part.section)?.entries ?? []) {
				if (entry.isPrivate || entry.seeNumber) continue;
				byName.set(entry.name, [
					...(byName.get(entry.name) ?? []),
					{ label: `${part.mark}${entry.number}`, href: `#${part.prefix}entry-${entry.number}` }
				]);
			}
		}
		const key = (name: string) => `${name.split(' ').at(-1)} ${name}`.toLowerCase();
		return [...byName].sort(([a], [b]) => key(a).localeCompare(key(b)));
	});
</script>

<svelte:head>
	<title>{heading} · {data.summary.tree.name} · Epoch</title>
</svelte:head>

<nav aria-label="Breadcrumb" class="text-sm text-stone-600 print:hidden">
	<a href={base} class="text-link">{data.summary.tree.name}</a> /
	<a href={personHref(subject.id)} class="text-link">{subject.name}</a>
</nav>

<!-- The fragment survives the GET, so a phone lands on the new book rather than the form above it. -->
<form
	method="get"
	action="#book-title"
	class="section-card mt-3 max-w-3xl text-sm print:hidden"
	aria-labelledby={formId}
>
	<h2 id={formId} class="section-heading">What the book holds</h2>
	<fieldset class="mt-2 flex flex-wrap gap-x-4 gap-y-1">
		<legend class="sr-only">Sections</legend>
		{#each Object.values(BOOK_SECTIONS) as section (section)}
			<label class="flex items-center gap-1.5">
				<input type="checkbox" name="section" value={section} checked={has(section)} />
				{BOOK_SECTION_LABELS[section]}
			</label>
		{/each}
	</fieldset>
	<div class="mt-3 flex flex-wrap items-center gap-3">
		<label class="flex items-center gap-2">
			<span class="font-semibold text-stone-700">Generations</span>
			<select name="generations" class="field-input w-auto" value={book.generations}>
				{#each Array.from({ length: MAX_NARRATIVE_GENERATIONS }, (_, i) => i + 1) as n (n)}
					<option value={n}>{n}</option>
				{/each}
			</select>
		</label>
		<button type="submit" class="action-btn">Make the book</button>
		<PrintButton />
	</div>
</form>

<header id="book-title" class="mt-8 scroll-mt-32 print:mt-[30vh] print:text-center">
	<h1 class="text-3xl font-bold text-stone-900">{heading}</h1>
	<p class="mt-2 text-stone-600">From {data.summary.tree.name}</p>
</header>

<nav
	aria-label="Contents"
	class="mt-8 max-w-3xl print:break-before-page"
	data-testid="book-contents"
>
	<h2 class="text-lg font-bold text-stone-900">Contents</h2>
	<ol class="mt-2 list-decimal space-y-1 pl-5 text-sm">
		{#each book.sections as section (section)}
			<li><a class="text-link" href="#book-{section}">{BOOK_SECTION_LABELS[section]}</a></li>
		{/each}
	</ol>
</nav>

{#each PARTS as part (part.section)}
	{@const narrative = narrativeOf(part.section)}
	{#if has(part.section) && narrative}
		<section
			id="book-{part.section}"
			aria-labelledby="book-{part.section}-heading"
			class="mt-10 print:break-before-page"
		>
			<h2 id="book-{part.section}-heading" class="text-2xl font-bold text-stone-900">
				{BOOK_SECTION_LABELS[part.section]} of {subject.name}
			</h2>
			<NarrativeBody {narrative} {personHref} idPrefix={part.prefix} level={3} />
		</section>
	{/if}
{/each}

{#if has(BOOK_SECTIONS.GAPS)}
	<section
		id="book-gaps"
		aria-labelledby="book-gaps-heading"
		class="mt-10 max-w-3xl print:break-before-page"
	>
		<h2 id="book-gaps-heading" class="text-2xl font-bold text-stone-900">Research gaps</h2>
		<ResearchGaps chart={book.pedigree} {personHref} level={3} />
	</section>
{/if}

{#if has(BOOK_SECTIONS.INDEX)}
	<section
		id="book-index"
		aria-labelledby="book-index-heading"
		class="mt-10 max-w-3xl print:break-before-page"
	>
		<h2 id="book-index-heading" class="text-2xl font-bold text-stone-900">Index of names</h2>
		<p class="mt-1 text-sm text-stone-600">A is the ancestors part, D the descendants part.</p>
		{#if index.length === 0}
			<p class="mt-2 text-sm text-stone-600">Tick a narrative to index its names.</p>
		{:else}
			<ul class="mt-2 columns-2 gap-6 text-sm" data-testid="book-index">
				{#each index as [name, refs] (name)}
					<li class="break-inside-avoid">
						{name}:
						{#each refs as ref, i (ref.href)}{i > 0 ? ', ' : ''}<a class="text-link" href={ref.href}
								>{ref.label}</a
							>{/each}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/if}
