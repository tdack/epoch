<script lang="ts">
	import PrintButton from '#lib/components/layout/PrintButton.svelte';
	import { dateReader } from '#lib/components/date-format.js';
	import ReportHeader from '#lib/components/reports/ReportHeader.svelte';
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

<ReportHeader
	crumbs={[
		{ label: data.summary.tree.name, href: base },
		{ label: page.person.displayName, href: personHref }
	]}
	title={heading}
>
	{#snippet summary()}{sourcedCount} of {claims.length} claims have a source.{/snippet}
	{#snippet actions()}<PrintButton />{/snippet}
</ReportHeader>

<div class="report-panel mt-5 max-w-4xl">
	<table class="report-table" data-testid="evidence-summary">
		<caption class="sr-only">{heading}</caption>
		<thead>
			<tr>
				<th scope="col">Claim</th>
				<th scope="col">Date</th>
				<th scope="col">Place</th>
				<th scope="col">Sources</th>
			</tr>
		</thead>
		<tbody>
			{#each claims as claim (claim.key)}
				<tr>
					<th scope="row">{claim.what}</th>
					<td class="whitespace-nowrap">{date(claim.date)}</td>
					<td>{claim.place ?? ''}</td>
					<td>
						{#if claim.citations.length === 0}
							<span class={claim.isKey ? 'font-medium text-amber-900' : 'text-stone-600'}
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
</div>
