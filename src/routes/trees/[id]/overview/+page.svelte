<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { taskSubjectPath } from '#lib/components/tasks/task-paths.js';
	import { getTreeContext } from '#lib/components/tree/tree-context.js';
	import EmptyTreePrompt from '#lib/components/tree/EmptyTreePrompt.svelte';
	import { canCreateRecords, canImportGedcom } from '#lib/shared/roles.js';
	import { personPath, unionPath } from '#lib/components/person/person-paths.js';
	import { treePath } from '#lib/shared/tree-slug.js';
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
	const base = $derived(treePath(data.summary.tree));
	const stats = $derived(data.overview.stats);
	const work = $derived(data.overview.work);
	const span = $derived(stats.birthSpan);
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
	const widest = $derived(Math.max(1, ...decades.map((d) => d.people)));
	// Ends and centuries only, and a century too near an end would print over the end's label.
	const LABEL_GAP_DECADES = 3;
	const isLabelled = (i: number, decade: number) =>
		i === 0 ||
		i === decades.length - 1 ||
		(decade % 100 === 0 && i >= LABEL_GAP_DECADES && decades.length - 1 - i >= LABEL_GAP_DECADES);
	const widestSurname = $derived(Math.max(1, ...stats.topSurnames.map((s) => s.people)));
	const recents = $derived(
		marks.recents.filter((r) => !marks.favorites.some((f) => f.id === r.id)).slice(0, RECENTS_SHOWN)
	);
	// Starts on the server's UTC day so the anniversary cards render in the first HTML instead of
	// shifting the page when they appear; the reader's own day replaces it once the page runs here.
	let today = $state(untrack(() => data.overview.today));
	// A change's time is the reader's clock too; the server's UTC text would survive hydration.
	let isOnReaderClock = $state(false);
	onMount(() => {
		isOnReaderClock = true;
		const now = new Date();
		today = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
			.map((n, i) => String(n).padStart(i === 0 ? 4 : 2, '0'))
			.join('-');
	});
	const dated = $derived(
		data.overview.anniversaries
			.map((a) => ({ ...a, next: nextOccurrence(a.monthDay, today) }))
			.sort((a, b) => a.next.days - b.next.days || a.year - b.year)
	);
	const onThisDay = $derived(dated.filter((a) => a.next.days === 0));
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
	// From the local day, not now plus whole days: a daylight-saving change would move it a day.
	const dayName = (days: number) => {
		if (days === 1) return 'Tomorrow';
		const [year, month, day] = today.split('-').map(Number) as [number, number, number];
		return new Date(year, month - 1, day + days).toLocaleDateString(undefined, {
			weekday: 'short',
			day: 'numeric',
			month: 'short'
		});
	};
	const ANNIVERSARIES_SHOWN = 5;
	const hasWork = $derived((work.myTasks?.open ?? 0) > 0 || (work.recentChanges?.length ?? 0) > 0);
	// Bars for one or two decades show nothing the two numbers don't; they go in a sentence instead.
	const MIN_DECADES_CHARTED = 3;
	const isDecadeChart = $derived(stats.birthsByDecade.length >= MIN_DECADES_CHARTED);
	const hasLives = $derived(stats.birthsByDecade.length > 0 || stats.averageLifespanYears !== null);
	// A task opens its record; one about nothing opens the tasks list, as the Tasks page does.
	const taskHref = (task: TaskDto) => taskSubjectPath(base, task) ?? `${base}/tasks?mine=true`;
	// The time for a change made today, else the day: five "26 Oct" stamps would say nothing.
	const stampOf = (at: Date) =>
		at.toDateString() === new Date().toDateString()
			? at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
			: at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
	const plural = (n: number, one: string, many: string) =>
		`${n.toLocaleString()} ${n === 1 ? one : many}`;
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
			>
			and
			<strong class="font-semibold text-stone-900"
				>{plural(stats.partnerships, 'partnership', 'partnerships')}</strong
			>.
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
		</p>
	{/if}
	{#if data.summary.subtree}
		<p class="mt-1 text-sm text-stone-600">
			Everything here covers the whole tree, not only this sub-tree.
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
	{#snippet onThisDayRow(a: (typeof onThisDay)[number])}
		<li>
			<a
				href={href(a)}
				class="text-link rounded-sm focus-ring coarse:inline-flex coarse:min-h-11 coarse:items-center"
				>{names(a)}</a
			>
			{VERBS[a.type]} in {a.year}
			<span class="text-stone-600"> ({plural(a.next.year - a.year, 'year', 'years')} ago)</span>.
		</li>
	{/snippet}
	{#snippet comingUpRow(a: (typeof comingUp)[number])}
		{@const years = a.next.year - a.year}
		<li class="flex justify-between gap-3">
			<span>
				<a
					href={href(a)}
					class="text-link rounded-sm focus-ring coarse:inline-flex coarse:min-h-11 coarse:items-center"
					>{names(a)}</a
				>
				<span class="text-stone-600">
					{a.type === 'BIRT' ? `turns ${years}` : plural(years, 'year married', 'years married')}
				</span>
			</span>
			<span class="shrink-0 text-stone-600">{dayName(a.next.days)}</span>
		</li>
	{/snippet}

	{#if onThisDay.length > 0 || comingUp.length > 0}
		<div class="mt-6 grid items-start gap-4 md:grid-cols-2">
			{#if onThisDay.length > 0}
				<section
					aria-labelledby="on-this-day"
					class="section-card {comingUp.length === 0 ? 'md:col-span-2' : ''}"
					data-testid="overview-on-this-day"
				>
					<h2 id="on-this-day" class="section-heading">On this day</h2>
					<ul class="mt-2 space-y-1 text-sm">
						{#each onThisDay.slice(0, ANNIVERSARIES_SHOWN) as a (a.id)}
							{@render onThisDayRow(a)}
						{/each}
					</ul>
					{#if onThisDay.length > ANNIVERSARIES_SHOWN}
						<details class="mt-1 text-sm">
							<summary
								class="cursor-pointer rounded-sm text-xs font-medium text-stone-600 focus-ring hover:text-stone-800 coarse:min-h-11"
								>Show all {onThisDay.length}</summary
							>
							<ul class="mt-1 space-y-1">
								{#each onThisDay.slice(ANNIVERSARIES_SHOWN) as a (a.id)}
									{@render onThisDayRow(a)}
								{/each}
							</ul>
						</details>
					{/if}
				</section>
			{/if}

			{#if comingUp.length > 0}
				<section
					aria-labelledby="coming-up"
					class="section-card {onThisDay.length === 0 ? 'md:col-span-2' : ''}"
					data-testid="overview-coming-up"
				>
					<h2 id="coming-up" class="section-heading">Coming up</h2>
					<p class="text-xs text-stone-600">
						Birthdays and wedding anniversaries in the next {UPCOMING_DAYS} days.
					</p>
					<ul class="mt-2 space-y-1 text-sm">
						{#each comingUp.slice(0, ANNIVERSARIES_SHOWN) as a (a.id)}
							{@render comingUpRow(a)}
						{/each}
					</ul>
					{#if comingUp.length > ANNIVERSARIES_SHOWN}
						<details class="mt-1 text-sm">
							<summary
								class="cursor-pointer rounded-sm text-xs font-medium text-stone-600 focus-ring hover:text-stone-800 coarse:min-h-11"
								>Show all {comingUp.length}</summary
							>
							<ul class="mt-1 space-y-1">
								{#each comingUp.slice(ANNIVERSARIES_SHOWN) as a (a.id)}
									{@render comingUpRow(a)}
								{/each}
							</ul>
						</details>
					{/if}
				</section>
			{/if}
		</div>
	{/if}

	<div class="mt-6 grid items-start gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
		<div class="space-y-4">
			{#if hasLives}
				<section
					aria-labelledby="births-by-decade"
					class="section-card"
					data-testid="overview-births"
				>
					<h2 id="births-by-decade" class="section-heading">Births by decade</h2>
					<p class="text-xs text-stone-600">People whose birth is dated to a single year.</p>
					{#if isDecadeChart}
						<ol class="mt-4 flex h-28 items-end gap-px" data-testid="overview-decades">
							{#each decades as row, i (row.decade)}
								<li class="group relative flex h-full min-w-0 flex-1 flex-col justify-end">
									<span class="sr-only">{row.decade}s: {plural(row.people, 'birth', 'births')}</span
									>
									{#if row.people > 0}
										<span
											aria-hidden="true"
											class="pointer-events-none mb-0.5 text-center text-xs font-semibold text-stone-800 tabular-nums opacity-0 transition-opacity group-hover:opacity-100"
											>{row.people}</span
										>
									{/if}
									<div
										aria-hidden="true"
										title="{row.decade}s: {plural(row.people, 'birth', 'births')}"
										class="mx-auto w-full max-w-8 rounded-t-sm transition-colors {row.people > 0
											? 'bg-stone-400 group-hover:bg-stone-600'
											: 'bg-stone-200'}"
										style:height={row.people > 0 ? `${(row.people / widest) * 85}%` : '2px'}
									></div>
									{#if isLabelled(i, row.decade)}
										<span
											aria-hidden="true"
											class="absolute top-full mt-1 text-xs whitespace-nowrap text-stone-600 tabular-nums {i ===
											0
												? 'left-0'
												: i === decades.length - 1
													? 'right-0'
													: 'left-1/2 -translate-x-1/2'}">{row.decade}s</span
										>
									{/if}
								</li>
							{/each}
						</ol>
						<div aria-hidden="true" class="h-5 border-t border-stone-300"></div>
					{:else if stats.birthsByDecade.length > 0}
						<p class="mt-2 text-sm text-stone-800">
							{stats.birthsByDecade
								.map((d) => `${d.people.toLocaleString()} in the ${d.decade}s`)
								.join(', ')}.
						</p>
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
								<li class="flex justify-between gap-3">
									<span class="text-stone-800">{change.summary}</span>
									<time datetime={change.createdAt.toISOString()} class="shrink-0 text-stone-600"
										>{isOnReaderClock ? stampOf(change.createdAt) : ''}</time
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
		</div>
		<div class="space-y-4">
			{#if stats.topSurnames.length > 0}
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
										class="h-1 rounded-full bg-stone-400"
										style:width="{(row.people / widestSurname) * 100}%"
									></div>
								</div>
							</li>
						{/each}
					</ol>
				</section>
			{/if}
			{#if marks.favorites.length > 0 || recents.length > 0}
				<section
					aria-labelledby="jump-back"
					class="section-card print:hidden"
					data-testid="overview-marks"
				>
					<h2 id="jump-back" class="section-heading">Jump back in</h2>
					{#each [{ label: 'Favourites', people: marks.favorites }, { label: 'Recently viewed', people: recents }] as group (group.label)}
						{#if group.people.length > 0}
							<h3 class="mt-3 text-xs font-semibold text-stone-600">
								{group.label}
							</h3>
							<ul class="mt-1 space-y-1 text-sm">
								{#each group.people as person (person.id)}
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
								{/each}
							</ul>
						{/if}
					{/each}
				</section>
			{/if}
		</div>
	</div>
{/if}
