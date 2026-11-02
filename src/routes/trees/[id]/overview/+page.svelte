<script lang="ts">
	import { taskSubjectPath } from '#lib/components/tasks/task-paths.js';
	import { getTreeContext } from '#lib/components/tree/tree-context.js';
	import DecadeChart from './DecadeChart.svelte';
	import EmptyTreePrompt from '#lib/components/tree/EmptyTreePrompt.svelte';
	import { canCreateRecords, canImportGedcom } from '#lib/shared/roles.js';
	import { personPath, unionPath } from '#lib/components/person/person-paths.js';
	import { treePath } from '#lib/shared/tree-slug.js';
	import { dayLabel, stampOf } from '#lib/shared/display-zone.js';
	import { lifeDates } from '#lib/shared/life-dates.js';
	import {
		nextOccurrence,
		UPCOMING_DAYS,
		type AnniversaryDto,
		type AnniversaryType
	} from '#lib/shared/overview.js';
	import type { TaskDto } from '#lib/shared/tasks.js';
	import type { PageData } from './$types';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	const { marks, editor, toasts, importGedcom } = getTreeContext();
	// Derived as the chart page does, so both tabs offer the same first steps to the same roles.
	const role = $derived(data.trees.find((t) => t.id === data.summary.tree.id)?.role);
	const RECENTS_SHOWN = 5;
	const FAVOURITES_SHOWN = 5;
	const base = $derived(treePath(data.summary.tree));
	const stats = $derived(data.overview.stats);
	const work = $derived(data.overview.work);
	const span = $derived(stats.birthSpan);
	const homePerson = $derived(data.overview.homePerson ?? null);
	// One surname is one full bar: it says nothing the lede's person count doesn't.
	const hasSurnameSpread = $derived(stats.topSurnames.length > 1);
	// Every decade from the first birth to the last, empty ones too, so a gap in the record shows.
	const decades = $derived.by(() => {
		const counts = new Map(stats.birthsByDecade.map((d) => [d.decade, d.people]));
		const first = stats.birthsByDecade[0]?.decade ?? 0;
		const last = stats.birthsByDecade.at(-1)?.decade ?? -10;
		return Array.from({ length: (last - first) / 10 + 1 }, (_, i) => {
			const decade = first + i * 10;
			return { decade, people: counts.get(decade) ?? 0 };
		});
	});
	const widestSurname = $derived(Math.max(1, ...stats.topSurnames.map((s) => s.people)));
	const recents = $derived(
		marks.recents
			.filter((r) => r.id !== homePerson?.id && !marks.favorites.some((f) => f.id === r.id))
			.slice(0, RECENTS_SHOWN)
	);
	// The server's day in the reader's zone (cookie), so the first HTML and the hydrated page agree.
	const today = $derived(data.overview.today);
	const dated = $derived(
		data.overview.anniversaries
			.map((a) => ({ ...a, next: nextOccurrence(a.monthDay, today) }))
			.sort((a, b) => a.next.days - b.next.days || a.year - b.year)
	);
	const todayItems = $derived(dated.filter((a) => a.next.days === 0));
	// A living birthday or a couple still together is something to mark; the rest is remembered.
	const todayNow = $derived(todayItems.filter((a) => a.isCurrent));
	const remembered = $derived(todayItems.filter((a) => !a.isCurrent));
	const comingUp = $derived(
		dated.filter((a) => a.isCurrent && a.next.days > 0 && a.next.days <= UPCOMING_DAYS)
	);
	const VERBS: Record<AnniversaryType, string> = {
		BIRT: 'was born',
		MARR: 'were married',
		DEAT: 'died'
	};
	const href = (a: AnniversaryDto) =>
		a.unionId
			? unionPath(data.summary.tree, a.unionId)
			: personPath(data.summary.tree, a.people[0]!.id);
	const names = (a: AnniversaryDto) => a.people.map((p) => p.name).join(' and ');
	const dayName = (days: number) => (days === 1 ? 'Tomorrow' : dayLabel(today, days));
	const ANNIVERSARIES_SHOWN = 5;
	// The record behind a change, or null (plain text) for a kind this page doesn't link.
	const changeHref = (record: { kind: string; id: string } | null | undefined) => {
		if (!record) return null;
		if (record.kind === 'union') return unionPath(data.summary.tree, record.id);
		if (record.kind === 'person') return personPath(data.summary.tree, record.id);
		if (record.kind === 'source') return `${base}/sources/${record.id}`;
		return null;
	};
	const hasWork = $derived((work.myTasks?.open ?? 0) > 0 || (work.recentChanges?.length ?? 0) > 0);
	// Bars for one or two decades show nothing the two numbers don't; they go in a sentence instead.
	const MIN_DECADES_CHARTED = 3;
	const isDecadeChart = $derived(stats.birthsByDecade.length >= MIN_DECADES_CHARTED);
	// A task opens its record; one about nothing opens the tasks list, as the Tasks page does.
	const taskHref = (task: TaskDto) => taskSubjectPath(base, task) ?? `${base}/tasks?mine=true`;
	const plural = (n: number, one: string, many: string) =>
		`${n.toLocaleString()} ${n === 1 ? one : many}`;
	const birthCoverage = $derived.by(() => {
		const { people, peopleWithBirthYear: dated } = stats;
		if (people === 1)
			return dated === 1
				? 'Their birth is dated to a year.'
				: 'Their birth is not dated to a year.';
		return `${dated.toLocaleString()} of ${people.toLocaleString()} people ${dated === 1 ? 'has' : 'have'} a birth dated to a year.`;
	});
	// Too few decades to chart, so the figures read as a sentence in the lede instead of a card.
	// A lone decade holding every dated birth only repeats the coverage sentence.
	const decadeSentence = $derived(
		isDecadeChart ||
			(stats.birthsByDecade.length === 1 &&
				stats.birthsByDecade[0]!.people === stats.peopleWithBirthYear)
			? ''
			: `Births by decade: ${stats.birthsByDecade.map((d) => `${d.people.toLocaleString()} in the ${d.decade}s`).join(', ')}.`
	);
	const hasBirthsCard = $derived(isDecadeChart || stats.averageLifespanYears !== null);
</script>

<svelte:head>
	<title>Overview · {data.summary.tree.name} · Epoch</title>
</svelte:head>

<header>
	<h1 class="text-2xl font-bold text-stone-900">Overview</h1>
	{#if stats.people > 0}
		<p
			class="mt-2 max-w-3xl text-base/relaxed text-pretty text-stone-700"
			data-testid="overview-lede"
		>
			{data.summary.tree.name} holds
			<strong class="font-semibold text-stone-900"
				>{plural(stats.people, 'person', 'people')}</strong
			>{#if stats.partnerships > 0}
				{' and '}
				<strong class="font-semibold text-stone-900"
					>{plural(stats.partnerships, 'partnership', 'partnerships')}</strong
				>{/if}.
			{#if span && span.earliest.id !== span.latest.id}
				Its dated births run from
				<a
					href={personPath(data.summary.tree, span.earliest.id)}
					class="text-link rounded-sm focus-ring">{span.earliest.name}</a
				>
				in {span.earliest.year} to
				<a
					href={personPath(data.summary.tree, span.latest.id)}
					class="text-link rounded-sm focus-ring">{span.latest.name}</a
				>
				in {span.latest.year}, across {plural(
					span.latest.year - span.earliest.year,
					'year',
					'years'
				)}.
			{/if}
			{birthCoverage}
			{decadeSentence}
			{#if data.overview.canViewQuality}
				<a href="{base}/quality" class="text-link rounded-sm whitespace-nowrap focus-ring"
					>See what is missing</a
				>.
			{/if}
		</p>
		<details class="mt-1 max-w-3xl">
			<summary
				class="cursor-pointer rounded-sm text-xs text-stone-600 focus-ring hover:text-stone-800 coarse:min-h-11"
				>How births are counted</summary
			>
			<p class="mt-1 text-xs text-stone-600">
				A birth counts when its date falls within one year: “about 1900” does, “between 1968 and
				1970” does not.
			</p>
		</details>
	{/if}
	{#if data.summary.subtree}
		<p class="mt-1 text-sm text-stone-600">
			The counts and lists on this page include people outside this sub-tree.
		</p>
	{/if}
</header>

{#if stats.people === 0}
	<EmptyTreePrompt
		canCreate={canCreateRecords(role)}
		canImport={canImportGedcom(role)}
		onAddPerson={editor.openAddPerson}
		onImport={importGedcom}
		onReject={(message) => toasts.push(message, { tone: 'error', durationMs: 10_000 })}
	/>
{:else}
	{#snippet rememberedRow(a: (typeof todayItems)[number])}
		<li class="grid">
			<a
				href={href(a)}
				class="text-link justify-self-start rounded-sm focus-ring coarse:inline-flex coarse:min-h-11 coarse:items-center"
				>{names(a)}</a
			>
			<span class="text-stone-600">
				{VERBS[a.type]} in {a.year} ({plural(a.next.year - a.year, 'year', 'years')} ago).
			</span>
		</li>
	{/snippet}
	{#snippet comingUpRow(a: (typeof dated)[number])}
		{@const years = a.next.year - a.year}
		{@const when = a.next.days === 0 ? ' today' : ''}
		<!-- The date shares the name's line and the detail takes its own, so neither wraps to an orphan at phone width. -->
		<li class="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3">
			<a
				href={href(a)}
				class="text-link justify-self-start rounded-sm focus-ring coarse:inline-flex coarse:min-h-11 coarse:items-center"
				>{names(a)}</a
			>
			{#if a.next.days > 0}<span class="text-stone-600">{dayName(a.next.days)}</span>{/if}
			<span class="col-span-2 text-stone-600">
				{a.type === 'BIRT'
					? `turns ${years}${when}`
					: `${plural(years, 'year', 'years')} married${when}`}
			</span>
		</li>
	{/snippet}
	{#snippet capped(list: typeof dated, row: typeof comingUpRow)}
		<ul class="mt-1 space-y-1 text-sm">
			{#each list.slice(0, ANNIVERSARIES_SHOWN) as a (a.id)}
				{@render row(a)}
			{/each}
		</ul>
		{#if list.length > ANNIVERSARIES_SHOWN}
			<details class="mt-1 text-sm">
				<summary
					class="cursor-pointer rounded-sm text-xs font-medium text-stone-600 focus-ring hover:text-stone-800 coarse:min-h-11"
					>Show all {list.length} anniversaries</summary
				>
				<ul class="mt-1 space-y-1">
					{#each list.slice(ANNIVERSARIES_SHOWN) as a (a.id)}
						{@render row(a)}
					{/each}
				</ul>
			</details>
		{/if}
	{/snippet}
	{#snippet personRow(person: (typeof marks.favorites)[number])}
		{@const dates = lifeDates(
			person.birthDate,
			person.deathDate,
			person.isDeceased,
			data.summary.tree.dateFormat
		)}
		<li class="flex flex-wrap items-center gap-x-1.5">
			<a
				href={personPath(data.summary.tree, person.id)}
				class="text-link rounded-sm focus-ring coarse:inline-flex coarse:min-h-11 coarse:items-center"
				>{person.displayName}</a
			>
			{#if dates}
				<span class="text-stone-600">{dates}</span>
			{/if}
		</li>
	{/snippet}

	{#if homePerson}
		<section aria-labelledby="start-here" class="section-card mt-6" data-testid="overview-start">
			<h2 id="start-here" class="section-heading">Where to start</h2>
			<p class="mt-1 text-sm font-bold text-stone-900">
				<a
					href={personPath(data.summary.tree, homePerson.id)}
					class="text-link rounded-sm focus-ring coarse:inline-flex coarse:min-h-11 coarse:items-center"
					>{homePerson.name}</a
				>
			</p>
			<p class="mt-1 text-sm text-stone-600">
				Your starting person.
				<a
					href="{personPath(data.summary.tree, homePerson.id)}/pedigree"
					class="text-link rounded-sm focus-ring coarse:inline-flex coarse:min-h-11 coarse:items-center"
					>See their ancestors as a chart</a
				>.
			</p>
		</section>
	{/if}

	<div class="mt-6 space-y-4">
		{#if hasWork}
			<section
				aria-labelledby="your-work"
				class="section-card print:hidden"
				data-testid="overview-work"
			>
				<h2 id="your-work" class="section-heading">Your work</h2>
				{#if work.myTasks && work.myTasks.open > 0}
					<h3 class="mt-3 text-xs font-semibold text-stone-600">Your open tasks</h3>
					<ul class="mt-1 space-y-1 text-sm">
						{#each work.myTasks.items as task (task.id)}
							<li>
								<a
									href={taskHref(task)}
									class="text-link rounded-sm focus-ring coarse:inline-flex coarse:min-h-11 coarse:items-center"
									>{task.title}</a
								>
								{#if task.subject}<span class="text-stone-600"> · {task.subject.label}</span>{/if}
							</li>
						{/each}
					</ul>
					<a
						href="{base}/tasks?mine=true"
						class="row-link mt-1 inline-block rounded-sm text-sm focus-ring coarse:inline-flex coarse:min-h-11 coarse:items-center"
					>
						{work.myTasks.open > work.myTasks.items.length
							? `All ${work.myTasks.open} of your tasks`
							: 'Your tasks'}
					</a>
				{/if}
				{#if work.recentChanges?.length}
					<h3 class="mt-3 text-xs font-semibold text-stone-600">Latest changes</h3>
					<ul class="mt-1 space-y-1 text-sm">
						{#each work.recentChanges as change (change.id)}
							{@const recordHref = changeHref(change.record)}
							<li class="flex justify-between gap-3">
								<span class="text-stone-800">
									{#if recordHref}
										<a href={recordHref} class="text-link rounded-sm focus-ring">{change.summary}</a
										>
									{:else}
										{change.summary}
									{/if}
									{#if change.actorName}<span class="text-stone-600">
											by {change.actorName}</span
										>{/if}
								</span>
								<time datetime={change.createdAt.toISOString()} class="shrink-0 text-stone-600"
									>{stampOf(change.createdAt, data.now, data.timeZone)}</time
								>
							</li>
						{/each}
					</ul>
					<a
						href="{base}/audit"
						class="row-link mt-1 inline-block rounded-sm text-sm focus-ring coarse:inline-flex coarse:min-h-11 coarse:items-center"
					>
						All changes in the audit log
					</a>
				{/if}
			</section>
		{/if}

		{#if marks.favorites.length > 0 || recents.length > 0}
			<section
				aria-labelledby="jump-back"
				class="section-card print:hidden"
				data-testid="overview-marks"
			>
				<h2 id="jump-back" class="section-heading">Jump back in</h2>
				<div class="grid gap-x-6 md:grid-cols-2">
					{#if marks.favorites.length > 0}
						<div>
							<h3 class="mt-3 text-xs font-semibold text-stone-600">Favourites</h3>
							<ul class="mt-1 space-y-1 text-sm">
								{#each marks.favorites.slice(0, FAVOURITES_SHOWN) as person (person.id)}
									{@render personRow(person)}
								{/each}
							</ul>
							{#if marks.favorites.length > FAVOURITES_SHOWN}
								<details class="mt-1 text-sm">
									<summary
										class="cursor-pointer rounded-sm text-xs font-medium text-stone-600 focus-ring hover:text-stone-800 coarse:min-h-11"
										>Show all {marks.favorites.length} favourites</summary
									>
									<ul class="mt-1 space-y-1">
										{#each marks.favorites.slice(FAVOURITES_SHOWN) as person (person.id)}
											{@render personRow(person)}
										{/each}
									</ul>
								</details>
							{/if}
						</div>
					{/if}
					{#if recents.length > 0}
						<div>
							<h3 class="mt-3 text-xs font-semibold text-stone-600">Recently viewed</h3>
							<ul class="mt-1 space-y-1 text-sm">
								{#each recents as person (person.id)}
									{@render personRow(person)}
								{/each}
							</ul>
						</div>
					{/if}
				</div>
			</section>
		{/if}

		{#if todayNow.length > 0 || comingUp.length > 0 || remembered.length > 0}
			<section aria-labelledby="coming-up" class="section-card" data-testid="overview-coming-up">
				<h2 id="coming-up" class="section-heading">Coming up</h2>
				<details class="mt-1">
					<summary
						class="cursor-pointer rounded-sm text-xs text-stone-600 focus-ring hover:text-stone-800 coarse:min-h-11"
						>What is listed</summary
					>
					<p class="mt-1 text-xs text-stone-600">
						Birthdays of living people and anniversaries of couples still together, in the next {UPCOMING_DAYS}
						days.
					</p>
				</details>
				{#if todayNow.length > 0}
					<h3 class="mt-3 text-xs font-semibold text-stone-600">Today</h3>
					{@render capped(todayNow, comingUpRow)}
				{/if}
				{#if comingUp.length > 0}
					{#if todayNow.length > 0}
						<h3 class="mt-3 text-xs font-semibold text-stone-600">Next {UPCOMING_DAYS} days</h3>
					{/if}
					{@render capped(comingUp, comingUpRow)}
				{/if}
				{#if remembered.length > 0}
					<h3 class="mt-3 text-xs font-semibold text-stone-600" data-testid="overview-on-this-day">
						Remembered today
					</h3>
					{@render capped(remembered, rememberedRow)}
				{/if}
			</section>
		{/if}

		{#if hasBirthsCard || hasSurnameSpread}
			<div
				class="grid grid-cols-1 items-start gap-4 {hasBirthsCard && hasSurnameSpread
					? 'md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]'
					: 'md:max-w-xl'}"
			>
				{#if hasBirthsCard}
					<section
						aria-labelledby="births-by-decade"
						class="section-card"
						data-testid="overview-births"
					>
						<h2 id="births-by-decade" class="section-heading">Births by decade</h2>
						{#if isDecadeChart}
							<DecadeChart {decades} labelledBy="births-by-decade" />
						{/if}
						{#if stats.averageLifespanYears !== null}
							<dl
								class="mt-3 grid gap-3 border-t border-stone-200 pt-3 text-sm sm:grid-cols-2"
								data-testid="overview-figures"
							>
								<div>
									<dt class="text-xs text-stone-600">Average lifespan</dt>
									<dd class="font-semibold text-stone-900">
										{plural(stats.averageLifespanYears, 'year', 'years')}
									</dd>
								</div>
								{#if stats.oldest}
									<div>
										<dt class="text-xs text-stone-600">Longest life recorded</dt>
										<dd class="text-stone-800">
											<a
												href={personPath(data.summary.tree, stats.oldest.id)}
												class="text-link rounded-sm focus-ring coarse:inline-flex coarse:min-h-11 coarse:items-center"
												>{stats.oldest.name}</a
											>, {plural(stats.oldest.years, 'year', 'years')}
										</dd>
									</div>
								{/if}
							</dl>
						{/if}
					</section>
				{/if}
				{#if hasSurnameSpread}
					<section
						aria-labelledby="top-surnames"
						class="section-card"
						data-testid="overview-surnames"
					>
						<h2 id="top-surnames" class="section-heading">Most common surnames</h2>
						<ol class="mt-3 space-y-2.5 text-sm">
							{#each stats.topSurnames as row (row.surname)}
								<li>
									<div class="flex items-baseline justify-between gap-2">
										<a
											href="{base}/people?surname={encodeURIComponent(row.surname)}"
											class="text-link rounded-sm focus-ring coarse:inline-flex coarse:min-h-11 coarse:items-center"
											>{row.surname}</a
										>
										<span class="text-stone-600 tabular-nums"
											>{plural(row.people, 'person', 'people')}</span
										>
									</div>
									<div aria-hidden="true" class="mt-1 h-1 rounded-full bg-stone-200">
										<div
											class="h-1 rounded-full bg-stone-500"
											style:width="{(row.people / widestSurname) * 100}%"
										></div>
									</div>
								</li>
							{/each}
						</ol>
					</section>
				{/if}
			</div>
		{/if}
	</div>
{/if}
