<script lang="ts">
	import { dateReader } from '#lib/components/date-format.js';
	import {
		CITATION_QUALITY_LABELS,
		CITATION_SUBJECT_KINDS,
		KEY_FACT_TYPES,
		type CitationDto,
		type CitationSubjectKind
	} from '#lib/shared/evidence.js';
	import { treePath } from '#lib/shared/tree-slug.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const page = $derived(data.person);
	const base = $derived(treePath(data.summary.tree));
	const date = dateReader();
	const personHref = $derived(`${base}/people/${encodeURIComponent(page.person.id)}`);
	const heading = $derived(`Evidence for ${page.person.displayName}`);

	const citationsOf = $derived.by(() => {
		const by = new Map<string, CitationDto[]>();
		for (const c of page.evidence.citations) {
			const key = `${c.subject.kind}|${c.subject.id}`;
			by.set(key, [...(by.get(key) ?? []), c]);
		}
		return (kind: CitationSubjectKind, id: string | null) =>
			id ? (by.get(`${kind}|${id}`) ?? []) : [];
	});

	interface Claim {
		key: string;
		what: string;
		date: string | null;
		place: string | null;
		/** A fact a researcher is expected to source, so a missing source is worth saying. */
		isKey: boolean;
		citations: CitationDto[];
	}
	const claims = $derived<Claim[]>([
		...(citationsOf(CITATION_SUBJECT_KINDS.PERSON, page.person.id).length > 0
			? [
					{
						key: 'person',
						what: 'The person',
						date: null,
						place: null,
						isKey: false,
						citations: citationsOf(CITATION_SUBJECT_KINDS.PERSON, page.person.id)
					}
				]
			: []),
		...page.names.map((n, i) => ({
			key: `name-${n.id ?? i}`,
			what: `Name: ${n.displayName}`,
			date: n.dateText,
			place: null,
			isKey: false,
			citations: citationsOf(CITATION_SUBJECT_KINDS.NAME, n.id)
		})),
		...page.facts.map((f) => ({
			key: f.id,
			what: f.value ? `${f.label}: ${f.value}` : f.label,
			date: f.dateText,
			place: f.place,
			isKey: (KEY_FACT_TYPES as readonly string[]).includes(f.type),
			citations: citationsOf(CITATION_SUBJECT_KINDS.EVENT, f.id)
		})),
		...page.evidence.links.map((l) => ({
			key: l.id,
			what: l.label,
			date: null,
			place: null,
			isKey: false,
			citations: citationsOf(CITATION_SUBJECT_KINDS.PARENT_CHILD, l.id)
		}))
	]);
	const sourcedCount = $derived(claims.filter((c) => c.citations.length > 0).length);
</script>

<svelte:head>
	<title>{heading} · {data.summary.tree.name} · Epoch</title>
</svelte:head>

<nav aria-label="Breadcrumb" class="text-sm text-stone-600 print:hidden">
	<a href={base} class="text-link">{data.summary.tree.name}</a> /
	<a href={personHref} class="text-link">{page.person.displayName}</a>
</nav>
<h1 class="mt-1 text-2xl font-bold text-stone-900">{heading}</h1>
<p class="mt-1 text-sm text-stone-600">
	{sourcedCount} of {claims.length} claims have a source.
</p>
<div class="mt-3 print:hidden">
	<button type="button" class="action-btn" onclick={() => window.print()}>Print</button>
</div>

<table class="mt-5 w-full max-w-4xl text-left text-sm" data-testid="evidence-summary">
	<caption class="sr-only">{heading}</caption>
	<thead class="border-b border-stone-300 text-stone-600">
		<tr>
			<th scope="col" class="py-1.5 pr-3 font-semibold">Claim</th>
			<th scope="col" class="py-1.5 pr-3 font-semibold">Date</th>
			<th scope="col" class="py-1.5 pr-3 font-semibold">Place</th>
			<th scope="col" class="py-1.5 font-semibold">Sources</th>
		</tr>
	</thead>
	<tbody>
		{#each claims as claim (claim.key)}
			<tr class="break-inside-avoid border-b border-stone-200 align-top">
				<th scope="row" class="py-1.5 pr-3 font-normal">{claim.what}</th>
				<td class="py-1.5 pr-3">{date(claim.date)}</td>
				<td class="py-1.5 pr-3">{claim.place ?? ''}</td>
				<td class="py-1.5">
					{#if claim.citations.length === 0}
						<span class="text-stone-600"
							>{claim.isKey ? 'No source yet: worth finding' : 'No source'}</span
						>
					{:else}
						<ul class="space-y-1">
							{#each claim.citations as c (c.id)}
								<li>
									{#if c.sourceId}
										<a class="text-link" href="{base}/sources/{encodeURIComponent(c.sourceId)}"
											>{c.sourceLabel}</a
										>
									{:else}
										{c.sourceLabel}
									{/if}{c.page ? `, ${c.page}` : ''}
									{#if c.quality !== null}
										<span class="text-stone-600"> · {CITATION_QUALITY_LABELS[c.quality]}</span>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</td>
			</tr>
		{/each}
	</tbody>
</table>
