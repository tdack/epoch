<script lang="ts">
	import PrintButton from '#lib/components/layout/PrintButton.svelte';
	import NarrativeBody from '#lib/components/reports/NarrativeBody.svelte';
	import ResearchGaps from '#lib/components/reports/ResearchGaps.svelte';
	import { brickWalls } from '#lib/shared/pedigree-stats.js';
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

	// Both parts open on the subject; the ancestors part tells them, the descendants part points back.
	const isRootFolded = $derived(has(BOOK_SECTIONS.ANCESTORS) && book.ancestors !== null);
	const rootToldAt = (section: BookSection) =>
		section === BOOK_SECTIONS.DESCENDANTS && isRootFolded
			? { label: 'A1 in the ancestors part', href: '#a-entry-1' }
			: null;

	// shortcut: sorts and inverts on the last word of the display name, which misfiles "Jr." and particles; upgrade with a surname field on the entry.
	const surnameFirst = (name: string) => {
		const words = name.split(' ');
		return words.length > 1 ? `${words.at(-1)}, ${words.slice(0, -1).join(' ')}` : name;
	};
	const index = $derived.by(() => {
		const byName = new Map<string, Array<{ label: string; href: string }>>();
		for (const part of PARTS) {
			for (const entry of narrativeOf(part.section)?.entries ?? []) {
				if (entry.isPrivate || entry.seeNumber) continue;
				if (rootToldAt(part.section) && entry.generation === 1) continue;
				byName.set(entry.name, [
					...(byName.get(entry.name) ?? []),
					{ label: `${part.mark}${entry.number}`, href: `#${part.prefix}entry-${entry.number}` }
				]);
			}
		}
		return [...byName]
			.map(([name, refs]) => ({ name: surnameFirst(name), refs }))
			.sort((a, b) => a.name.localeCompare(b.name));
	});
	/** The index under letter headings, as a printed index reads. */
	const indexGroups = $derived.by(() => {
		const groups = new Map<string, typeof index>();
		for (const item of index) {
			const letter = item.name.charAt(0).toLocaleUpperCase();
			groups.set(letter, [...(groups.get(letter) ?? []), item]);
		}
		return [...groups];
	});

	const told = (narrative: NarrativeDto | null) =>
		narrative?.entries.filter((e) => !e.isPrivate && !e.seeNumber).length ?? 0;
	const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
	/** What each part holds, beside its line in the contents. */
	const extent = $derived<Record<BookSection, string>>({
		[BOOK_SECTIONS.ANCESTORS]: plural(told(book.ancestors), 'person', 'people'),
		[BOOK_SECTIONS.DESCENDANTS]: plural(told(book.descendants), 'person', 'people'),
		[BOOK_SECTIONS.GAPS]: plural(brickWalls(book.pedigree).length, 'brick wall', 'brick walls'),
		[BOOK_SECTIONS.INDEX]: plural(index.length, 'name', 'names')
	});
	const PART_NOTES: Record<(typeof PARTS)[number]['section'], string> = {
		[BOOK_SECTIONS.ANCESTORS]: 'Numbered by Ahnentafel: the parents of number n are 2n and 2n + 1.',
		[BOOK_SECTIONS.DESCENDANTS]:
			"Numbered d'Aboville: each child adds a place to their parent's number."
	};
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

<header
	id="book-title"
	class="mt-10 max-w-2xl scroll-mt-32 print:mt-[28vh] print:max-w-none print:text-center"
>
	<h1 class="text-2xl font-bold text-balance text-stone-900 print:text-4xl">{heading}</h1>
	<p class="mt-2 text-sm text-stone-600 print:mt-4 print:text-base">
		From {data.summary.tree.name} · {plural(book.generations, 'generation', 'generations')}
	</p>
</header>

<nav
	aria-label="Contents"
	class="mt-8 max-w-md print:mt-0 print:max-w-lg print:break-before-page"
	data-testid="book-contents"
>
	<h2 class="section-heading border-b border-stone-200 pb-1.5 print:border-stone-400">Contents</h2>
	<ol class="text-sm">
		{#each book.sections as section (section)}
			<li class="flex items-baseline gap-3 border-b border-stone-100 py-2 print:border-stone-200">
				<a class="text-link" href="#book-{section}">{BOOK_SECTION_LABELS[section]}</a>
				<span class="ml-auto text-xs text-stone-500 tabular-nums">{extent[section]}</span>
			</li>
		{/each}
	</ol>
</nav>

{#each PARTS as part (part.section)}
	{@const narrative = narrativeOf(part.section)}
	{#if has(part.section) && narrative}
		<section
			id="book-{part.section}"
			aria-labelledby="book-{part.section}-heading"
			class="mt-16 scroll-mt-32 print:mt-0 print:break-before-page"
		>
			<h2
				id="book-{part.section}-heading"
				class="max-w-2xl text-xl font-bold text-balance text-stone-900 print:text-2xl"
			>
				{BOOK_SECTION_LABELS[part.section]} of {subject.name}
			</h2>
			<p class="mt-1 max-w-2xl text-sm text-stone-600">{PART_NOTES[part.section]}</p>
			<NarrativeBody
				{narrative}
				{personHref}
				idPrefix={part.prefix}
				level={3}
				rootToldAt={rootToldAt(part.section)}
			/>
		</section>
	{/if}
{/each}

{#if has(BOOK_SECTIONS.GAPS)}
	<section
		id="book-gaps"
		aria-labelledby="book-gaps-heading"
		class="mt-16 max-w-3xl scroll-mt-32 print:mt-0 print:break-before-page"
	>
		<h2 id="book-gaps-heading" class="text-xl font-bold text-stone-900 print:text-2xl">
			Research gaps
		</h2>
		<ResearchGaps chart={book.pedigree} {personHref} level={3} />
	</section>
{/if}

{#if has(BOOK_SECTIONS.INDEX)}
	<section
		id="book-index"
		aria-labelledby="book-index-heading"
		class="mt-16 max-w-3xl scroll-mt-32 print:mt-0 print:max-w-none print:break-before-page"
	>
		<h2 id="book-index-heading" class="text-xl font-bold text-stone-900 print:text-2xl">
			Index of names
		</h2>
		<p class="mt-1 text-sm text-stone-600">
			A refers to the ancestors part and D to the descendants part, then the person's number.
		</p>
		{#if index.length === 0}
			<p class="mt-4 text-sm text-stone-600">Tick a narrative to index its names.</p>
		{:else}
			<div class="mt-6 gap-8 text-sm sm:columns-2 lg:columns-3" data-testid="book-index">
				{#each indexGroups as [letter, items] (letter)}
					<h3 class="section-heading mt-4 break-after-avoid first:mt-0">{letter}</h3>
					<ul class="mt-1 space-y-0.5">
						{#each items as item (item.name)}
							<li class="break-inside-avoid pl-4 -indent-4">
								<span class="text-stone-800">{item.name}</span>
								<span class="ml-1 text-stone-500 tabular-nums">
									{#each item.refs as ref, i (ref.href)}{i > 0 ? ', ' : ''}<a
											class="row-link"
											href={ref.href}>{ref.label}</a
										>{/each}
								</span>
							</li>
						{/each}
					</ul>
				{/each}
			</div>
		{/if}
	</section>
{/if}
