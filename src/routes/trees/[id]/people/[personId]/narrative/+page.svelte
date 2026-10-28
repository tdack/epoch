<script lang="ts">
	import PrintButton from '#lib/components/layout/PrintButton.svelte';
	import GenerationStepper from '#lib/components/charts/GenerationStepper.svelte';
	import NarrativeBody from '#lib/components/reports/NarrativeBody.svelte';
	import ReportHeader from '#lib/components/reports/ReportHeader.svelte';
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
	const about = $derived(
		dto.kind === NARRATIVE_KINDS.ANCESTORS
			? `${dto.generations} ${dto.generations === 1 ? 'generation' : 'generations'}, numbered by Ahnentafel: the parents of number n are 2n and 2n + 1.`
			: `${dto.generations} ${dto.generations === 1 ? 'generation' : 'generations'}, each person numbered by their line of descent.`
	);
	const numberingId = $props.id();
</script>

<svelte:head>
	<title>{heading} · {data.summary.tree.name} · Epoch</title>
</svelte:head>

<ReportHeader
	crumbs={[
		{ label: data.summary.tree.name, href: base },
		{ label: dto.person.name, href: personHref(dto.person.id) }
	]}
	title={heading}
>
	{#snippet summary()}{about}{/snippet}
	{#snippet actions()}
		<nav aria-label="Narrative kind" class="flex gap-1">
			{#each Object.values(NARRATIVE_KINDS) as kind (kind)}
				<a
					href={address(kind, dto.generations, numbering)}
					aria-current={kind === dto.kind ? 'page' : undefined}
					class="rounded-lg border px-2.5 py-1 font-semibold focus-ring coarse:min-h-11 coarse:content-center {kind ===
					dto.kind
						? 'border-emerald-800 bg-emerald-800 text-amber-50'
						: 'border-stone-300 text-stone-700 hover:bg-stone-100'}"
					>{kind === NARRATIVE_KINDS.ANCESTORS ? 'Ancestors' : 'Descendants'}</a
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
		<PrintButton />
	{/snippet}
</ReportHeader>

<NarrativeBody narrative={dto} {personHref} />
