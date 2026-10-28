<script lang="ts">
	import PrintButton from '#lib/components/layout/PrintButton.svelte';
	import { dateReader } from '#lib/components/date-format.js';
	import PersonLink from '#lib/components/PersonLink.svelte';
	import { PARENT_CHILD_TYPES, type ParentChildType } from '#lib/shared/relationship-model.js';
	import { treePath } from '#lib/shared/tree-slug.js';
	import { UNION_STATUS_LABELS } from '#lib/shared/union-events.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const showDate = dateReader();

	const dto = $derived(data.sheet.page);
	const treeHref = $derived(treePath(data.summary.tree));
	const personHref = (id: string) => `${treeHref}/people/${encodeURIComponent(id)}`;
	const unionHref = $derived(`${treeHref}/unions/${encodeURIComponent(dto.union.id)}`);
	const title = $derived(dto.partners.map((p) => p.displayName).join(' and ') || 'Partnership');

	/** A link that is not the usual one is worth saying; "biological" is the unremarkable case. */
	const LINK_WORDS: Record<ParentChildType, string> = {
		[PARENT_CHILD_TYPES.BIOLOGICAL]: '',
		[PARENT_CHILD_TYPES.ADOPTIVE]: 'adopted by',
		[PARENT_CHILD_TYPES.FOSTER]: 'fostered by',
		[PARENT_CHILD_TYPES.GUARDIAN]: 'ward of',
		[PARENT_CHILD_TYPES.UNKNOWN]: 'link unknown for'
	};
	const unusualLinks = (links: Array<{ parentName: string; type: ParentChildType }>) =>
		links
			.filter((l) => l.type !== PARENT_CHILD_TYPES.BIOLOGICAL)
			.map((l) => `${LINK_WORDS[l.type]} ${l.parentName}`);
	const vital = (personId: string, type: string) =>
		data.sheet.vitals[personId]?.find((v) => v.type === type);
	const dateAndPlace = (v: { dateText: string | null; place: string | null } | undefined) =>
		[showDate(v?.dateText), v?.place].filter(Boolean).join(', ');

	const citations = $derived(dto.evidence.citations);
</script>

<svelte:head>
	<title>Family group sheet: {title} · {data.summary.tree.name} · Epoch</title>
</svelte:head>

<nav aria-label="Breadcrumb" class="text-xs text-stone-600 print:hidden">
	<a href={treeHref} class="text-link">{data.summary.tree.name}</a>
	<span aria-hidden="true"> › </span>
	<a href={unionHref} class="text-link">{title}</a>
</nav>

<header class="flex flex-wrap items-start justify-between gap-3">
	<div>
		<h1 class="text-2xl font-bold text-stone-900">Family group sheet</h1>
		<p class="mt-1 text-sm text-stone-600">
			{title} · {dto.union.label?.full ?? 'Partnership'} · {UNION_STATUS_LABELS[dto.union.status]}
		</p>
	</div>
	<div class="flex flex-wrap items-center gap-3 print:hidden">
		<a href={unionHref} class="text-link text-sm">Back to the partnership</a>
		<PrintButton />
	</div>
</header>

<div class="mt-4 space-y-4">
	{#each dto.partners as partner, i (partner.id)}
		<section aria-labelledby="partner-{i}" class="section-card break-inside-avoid">
			<h2 id="partner-{i}" class="section-heading">Partner {i + 1}</h2>
			<p class="mt-1 text-base font-semibold">
				<PersonLink person={partner} href={personHref(partner.id)} />
			</p>
			{#if !partner.isPrivate}
				<dl class="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
					{#each data.sheet.vitals[partner.id] ?? [] as v (v.type)}
						<dt class="text-stone-600">{v.label}</dt>
						<dd>{dateAndPlace(v) || 'Unknown'}</dd>
					{/each}
					{#each data.sheet.parents[partner.id] ?? [] as parent (parent.person.id)}
						<dt class="text-stone-600">Parent</dt>
						<dd>
							<PersonLink person={parent.person} href={personHref(parent.person.id)} />
							{#if parent.type !== PARENT_CHILD_TYPES.BIOLOGICAL}<span class="text-stone-600"
									>({parent.type})</span
								>{/if}
						</dd>
					{/each}
				</dl>
			{/if}
		</section>
	{/each}

	{#if dto.events.length > 0}
		<section aria-labelledby="sheet-events" class="section-card break-inside-avoid">
			<h2 id="sheet-events" class="section-heading">The partnership</h2>
			<dl class="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
				{#each dto.events as event (event.id)}
					<dt class="text-stone-600">{event.label}</dt>
					<dd>{dateAndPlace(event) || 'Date unknown'}</dd>
				{/each}
				<dt class="text-stone-600">Status</dt>
				<dd>{UNION_STATUS_LABELS[dto.union.status]}</dd>
			</dl>
		</section>
	{/if}

	<section aria-labelledby="sheet-children" class="section-card">
		<h2 id="sheet-children" class="section-heading">Children</h2>
		{#if dto.children.length === 0}
			<p class="mt-2 text-sm text-stone-600">No children recorded.</p>
		{:else}
			<table class="mt-2 w-full text-left text-sm" data-testid="sheet-children">
				<thead>
					<tr class="border-b border-stone-300 text-xs text-stone-600">
						<th scope="col" class="py-1 pr-3">Name</th>
						<th scope="col" class="py-1 pr-3">Born</th>
						<th scope="col" class="py-1 pr-3">Died</th>
						<th scope="col" class="py-1">Partners</th>
					</tr>
				</thead>
				<tbody>
					{#each dto.children as child (child.person.id)}
						{@const id = child.person.id}
						<tr class="break-inside-avoid border-b border-stone-200 align-top">
							<th scope="row" class="py-1 pr-3 font-medium">
								<PersonLink person={child.person} href={personHref(id)} />
								{#each unusualLinks(child.links) as note (note)}
									<span class="block text-xs font-normal text-stone-600">{note}</span>
								{/each}
							</th>
							{#if child.person.isPrivate}
								<td class="py-1 pr-3"></td><td class="py-1 pr-3"></td><td class="py-1"></td>
							{:else}
								<td class="py-1 pr-3">{dateAndPlace(vital(id, 'BIRT')) || ''}</td>
								<td class="py-1 pr-3">{dateAndPlace(vital(id, 'DEAT')) || ''}</td>
								<td class="py-1">
									{#each data.sheet.partnersOfChildren[id] ?? [] as p, i (p.unionId)}{i > 0
											? ', '
											: ''}<PersonLink person={p.person} href={personHref(p.person.id)} />{/each}
								</td>
							{/if}
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</section>

	{#if dto.notes.length > 0}
		<section aria-labelledby="sheet-notes" class="section-card">
			<h2 id="sheet-notes" class="section-heading">Notes</h2>
			<ul class="mt-2 space-y-1 text-sm">
				{#each dto.notes as note (note.id)}<li class="whitespace-pre-line">{note.text}</li>{/each}
			</ul>
		</section>
	{/if}

	{#if citations.length > 0}
		<section aria-labelledby="sheet-sources" class="section-card">
			<h2 id="sheet-sources" class="section-heading">Sources</h2>
			<ol class="mt-2 list-decimal space-y-1 pl-5 text-sm">
				{#each citations as c (c.id)}
					<li>{c.sourceLabel}{c.page ? `, ${c.page}` : ''}{c.text ? `: ${c.text}` : ''}</li>
				{/each}
			</ol>
		</section>
	{/if}
</div>
