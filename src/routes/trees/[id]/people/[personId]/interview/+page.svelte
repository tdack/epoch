<script lang="ts">
	import { dateReader } from '#lib/components/date-format.js';
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

<nav aria-label="Breadcrumb" class="text-sm text-stone-600 print:hidden">
	<a href={base} class="text-link">{data.summary.tree.name}</a> /
	<a href={personHref} class="text-link">{name}</a>
</nav>
<h1 class="mt-1 text-2xl font-bold text-stone-900">{heading}</h1>
<p class="mt-2 text-sm text-stone-700">
	Interviewed by <span class="inline-block w-48 border-b border-stone-400"></span> on
	<span class="inline-block w-32 border-b border-stone-400"></span>
</p>
<div class="mt-3 print:hidden">
	<button type="button" class="action-btn" onclick={() => window.print()}>Print</button>
</div>

<div class="mt-5 max-w-3xl space-y-6">
	<section aria-labelledby="recorded-heading">
		<h2 id="recorded-heading" class="section-heading">What the tree records</h2>
		<p class="mt-1 text-sm text-stone-600">Tick what is right; write any correction beneath.</p>
		{#if recorded.length === 0}
			<p class="mt-2 text-sm text-stone-600">Nothing is recorded yet.</p>
		{:else}
			<ul class="mt-2 space-y-3 text-sm" data-testid="interview-recorded">
				{#each recorded as item (item.key)}
					<li class="break-inside-avoid">
						<span aria-hidden="true">☐</span>
						{item.text}
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
