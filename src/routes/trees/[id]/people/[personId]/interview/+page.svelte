<script lang="ts">
	import PrintButton from '#lib/components/layout/PrintButton.svelte';
	import { dateReader } from '#lib/components/date-format.js';
	import ReportHeader from '#lib/components/reports/ReportHeader.svelte';
	import { treePath } from '#lib/shared/tree-slug.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const page = $derived(data.person);
	const base = $derived(treePath(data.summary.tree));
	const date = dateReader();
	const personHref = $derived(`${base}/people/${encodeURIComponent(page.person.id)}`);
	const name = $derived(page.person.displayName);
	const heading = $derived(`Interview sheet: ${name}`);

	const when = (dateText: string | null, place: string | null) =>
		[date(dateText), place].filter(Boolean).join(', ') || 'not recorded';
	const names = (people: Array<{ displayName: string }>) =>
		people.map((p) => p.displayName).join(', ');

	/** What the tree records, each to be confirmed or corrected. */
	const recorded = $derived([
		...page.facts.map((f) => ({
			key: f.id,
			text: `${f.label}${f.value ? `: ${f.value}` : ''} (${when(f.dateText, f.place)})`
		})),
		...page.parentFamilies
			.filter((f) => f.parents.length > 0)
			.map((f, i) => ({
				key: `parents-${i}`,
				text: `Parents: ${names(f.parents.map((p) => p.person))}`
			})),
		...page.partnerships.map((p) => ({
			key: p.unionId,
			text: `Partner: ${names(p.partners.filter((x) => x.id !== page.person.id)) || 'not recorded'}${
				p.children.length > 0 ? `; children: ${names(p.children.map((c) => c.person))}` : ''
			}`
		})),
		...(page.directChildren.length > 0
			? [{ key: 'children', text: `Children: ${names(page.directChildren.map((c) => c.person))}` }]
			: [])
	]);

	/** Gaps the person may be able to fill. */
	const missing = $derived.by(() => {
		const has = (type: string) => page.facts.some((f) => f.type === type);
		const birth = page.vitals.birth;
		return [
			!birth && `When and where was ${name} born?`,
			birth && !birth.dateText && `What was the date of ${name}'s birth?`,
			birth && !birth.place && `Where was ${name} born?`,
			page.parentFamilies.every((f) => f.parents.length === 0) &&
				`What were the full names of ${name}'s parents?`,
			page.partnerships.some((p) => p.events.length === 0) &&
				'When and where did each partnership begin?',
			!has('OCCU') && `What work has ${name} done?`,
			!has('RESI') && `Where has ${name} lived, and when?`,
			page.person.isDeceased &&
				!page.vitals.death?.place &&
				`Where did ${name} die, and where were they laid to rest?`
		].filter((q): q is string => Boolean(q));
	});

	const questions = [
		'What is your earliest memory?',
		'Which of your grandparents do you remember, and what were they like?',
		'What stories were told in the family about where it came from?',
		'Do you have photographs, letters, certificates or a family Bible?',
		'Who else in the family should we talk to?'
	];
</script>

<svelte:head>
	<title>{heading} · {data.summary.tree.name} · Epoch</title>
</svelte:head>

<ReportHeader
	crumbs={[
		{ label: data.summary.tree.name, href: base },
		{ label: name, href: personHref }
	]}
	title={heading}
>
	{#snippet summary()}
		Interviewed by <span class="inline-block w-48 border-b border-stone-400"></span> on
		<span class="inline-block w-32 border-b border-stone-400"></span>
	{/snippet}
	{#snippet actions()}<PrintButton />{/snippet}
</ReportHeader>

<div class="mt-6 max-w-2xl space-y-8">
	<section aria-labelledby="recorded-heading">
		<h2 id="recorded-heading" class="section-heading">What the tree records</h2>
		<p class="mt-1 text-sm text-stone-600">Tick what is right; write any correction beneath.</p>
		{#if recorded.length === 0}
			<p class="mt-2 text-sm text-stone-600">Nothing is recorded yet.</p>
		{:else}
			<ul class="mt-2 space-y-3 text-sm" data-testid="interview-recorded">
				{#each recorded as item (item.key)}
					<li class="break-inside-avoid">
						<span class="flex items-start gap-2.5">
							<!-- A box to tick with a pen; drawn, so it prints the same on every system. -->
							<span
								class="mt-0.5 size-3.5 shrink-0 rounded-[3px] border border-stone-500"
								aria-hidden="true"
							></span>
							<span>{item.text}</span>
						</span>
						<div class="mt-4 border-b border-stone-300"></div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	{#if missing.length > 0}
		<section aria-labelledby="missing-heading">
			<h2 id="missing-heading" class="section-heading">What the tree is missing</h2>
			<ol class="mt-2 list-decimal space-y-3 pl-5 text-sm" data-testid="interview-missing">
				{#each missing as question (question)}
					<li class="break-inside-avoid">
						{question}
						<div class="mt-6 border-b border-stone-300"></div>
					</li>
				{/each}
			</ol>
		</section>
	{/if}

	<section aria-labelledby="questions-heading">
		<h2 id="questions-heading" class="section-heading">Stories and memories</h2>
		<ol class="mt-2 list-decimal space-y-3 pl-5 text-sm">
			{#each questions as question (question)}
				<li class="break-inside-avoid">
					{question}
					<div class="mt-6 border-b border-stone-300"></div>
					<div class="mt-6 border-b border-stone-300"></div>
				</li>
			{/each}
		</ol>
	</section>
</div>
