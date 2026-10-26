<script lang="ts">
	import { onMount } from 'svelte';
	import { getTreeContext } from '#lib/components/tree/tree-context.js';
	import { personPath, unionPath } from '#lib/components/person/person-paths.js';
	import { treePath } from '#lib/shared/tree-slug.js';
	import {
		nextOccurrence,
		UPCOMING_DAYS,
		type AnniversaryDto,
		type AnniversaryType
	} from '#lib/shared/overview.js';
	import type { PageData } from './$types';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	const { marks } = getTreeContext();
	const RECENTS_SHOWN = 5;
	const base = $derived(treePath(data.summary.tree));
	const stats = $derived(data.overview.stats);
	const work = $derived(data.overview.work);
	const widest = $derived(Math.max(1, ...stats.birthsByCentury.map((c) => c.people)));
	const recents = $derived(
		marks.recents.filter((r) => !marks.favorites.some((f) => f.id === r.id)).slice(0, RECENTS_SHOWN)
	);
	// Today by the reader's clock, not the server's UTC one, so set only once the page runs here.
	let today = $state<string | null>(null);
	onMount(() => {
		const now = new Date();
		today = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
			.map((n, i) => String(n).padStart(i === 0 ? 4 : 2, '0'))
			.join('-');
	});
	const dated = $derived(
		today === null
			? []
			: data.overview.anniversaries
					.map((a) => ({ ...a, next: nextOccurrence(a.monthDay, today!) }))
					.sort((a, b) => a.next.days - b.next.days || a.year - b.year)
	);
	const onThisDay = $derived(dated.filter((a) => a.next.days === 0));
	const comingUp = $derived(
		dated.filter((a) => a.isCurrent && a.next.days > 0 && a.next.days <= UPCOMING_DAYS)
	);
	const VERBS: Record<AnniversaryType, string> = {
		BIRT: 'born',
		MARR: 'married',
		DEAT: 'died'
	};
	const href = (a: AnniversaryDto) =>
		a.unionId
			? unionPath(data.summary.tree, a.unionId)
			: personPath(data.summary.tree, a.people[0]!.id);
	const names = (a: AnniversaryDto) => a.people.map((p) => p.name).join(' and ');
	const dayName = (days: number) =>
		days === 1
			? 'Tomorrow'
			: new Date(Date.now() + days * 86_400_000).toLocaleDateString(undefined, {
					weekday: 'short',
					day: 'numeric',
					month: 'short'
				});
	const plural = (n: number, one: string, many: string) =>
		`${n.toLocaleString()} ${n === 1 ? one : many}`;
</script>

<svelte:head>
	<title>Overview · {data.summary.tree.name} · Epoch</title>
</svelte:head>

<header>
	<h1 class="text-2xl font-bold text-stone-900">Overview</h1>
	<p class="mt-1 text-sm text-stone-600">
		{plural(stats.people, 'person', 'people')} and {plural(
			stats.partnerships,
			'partnership',
			'partnerships'
		)}{data.summary.subtree ? ' across the whole tree, not only this sub-tree' : ''}.
	</p>
</header>

<div class="grid gap-4 md:grid-cols-2">
	{#if onThisDay.length > 0}
		<section
			aria-labelledby="on-this-day"
			class="rounded-xl border border-stone-200 bg-white p-4"
			data-testid="overview-on-this-day"
		>
			<h2 id="on-this-day" class="font-semibold text-stone-900">On this day</h2>
			<ul class="mt-2 space-y-1 text-sm">
				{#each onThisDay as a (a.id)}
					<li>
						<a href={href(a)} class="font-semibold text-emerald-900 hover:underline">{names(a)}</a>
						{a.type === 'MARR' ? 'were' : 'was'}
						{VERBS[a.type]} in {a.year}
						<span class="text-stone-600">
							({plural(a.next.year - a.year, 'year', 'years')} ago)</span
						>.
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if comingUp.length > 0}
		<section
			aria-labelledby="coming-up"
			class="rounded-xl border border-stone-200 bg-white p-4"
			data-testid="overview-coming-up"
		>
			<h2 id="coming-up" class="font-semibold text-stone-900">Coming up</h2>
			<p class="text-xs text-stone-600">
				Birthdays and wedding anniversaries in the next {UPCOMING_DAYS} days.
			</p>
			<ul class="mt-2 space-y-1 text-sm">
				{#each comingUp as a (a.id)}
					{@const years = a.next.year - a.year}
					<li class="flex justify-between gap-3">
						<span>
							<a href={href(a)} class="font-semibold text-emerald-900 hover:underline">{names(a)}</a
							>
							<span class="text-stone-600">
								{a.type === 'BIRT' ? `turns ${years}` : `${years} years married`}
							</span>
						</span>
						<span class="shrink-0 text-stone-600">{dayName(a.next.days)}</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if work.myTasks || work.recentChanges?.length}
		<section
			aria-labelledby="your-work"
			class="rounded-xl border border-stone-200 bg-white p-4"
			data-testid="overview-work"
		>
			<h2 id="your-work" class="font-semibold text-stone-900">Your work</h2>
			{#if work.myTasks}
				<h3 class="mt-3 text-xs font-semibold tracking-wide text-stone-600 uppercase">
					Your open tasks
				</h3>
				{#if work.myTasks.items.length === 0}
					<p class="mt-1 text-sm text-stone-700">None given to you.</p>
				{:else}
					<ul class="mt-1 space-y-1 text-sm">
						{#each work.myTasks.items as task (task.id)}
							<li>
								<span class="font-semibold text-stone-900">{task.title}</span>
								{#if task.subject}<span class="text-stone-600"> · {task.subject.label}</span>{/if}
							</li>
						{/each}
					</ul>
				{/if}
				<a
					href="{base}/tasks?mine=true"
					class="mt-1 inline-block text-sm text-emerald-900 underline"
				>
					{work.myTasks.open > work.myTasks.items.length
						? `All ${work.myTasks.open} of your tasks`
						: 'Tasks'}
				</a>
			{/if}
			{#if work.recentChanges?.length}
				<h3 class="mt-3 text-xs font-semibold tracking-wide text-stone-600 uppercase">
					Latest changes
				</h3>
				<ul class="mt-1 space-y-1 text-sm">
					{#each work.recentChanges as change (change.id)}
						<li class="flex justify-between gap-3">
							<span class="text-stone-800">{change.summary}</span>
							<time datetime={change.createdAt.toISOString()} class="shrink-0 text-stone-600"
								>{change.createdAt.toLocaleDateString(undefined, {
									day: 'numeric',
									month: 'short'
								})}</time
							>
						</li>
					{/each}
				</ul>
				<a href="{base}/audit" class="mt-1 inline-block text-sm text-emerald-900 underline">
					Audit log
				</a>
			{/if}
		</section>
	{/if}

	{#if marks.favorites.length > 0 || recents.length > 0}
		<section
			aria-labelledby="jump-back"
			class="rounded-xl border border-stone-200 bg-white p-4"
			data-testid="overview-marks"
		>
			<h2 id="jump-back" class="font-semibold text-stone-900">Jump back in</h2>
			{#each [{ label: 'Favourites', people: marks.favorites }, { label: 'Recently viewed', people: recents }] as group (group.label)}
				{#if group.people.length > 0}
					<h3 class="mt-3 text-xs font-semibold tracking-wide text-stone-600 uppercase">
						{group.label}
					</h3>
					<ul class="mt-1 space-y-1 text-sm">
						{#each group.people as person (person.id)}
							<li>
								<a
									href={personPath(data.summary.tree, person.id)}
									class="font-semibold text-emerald-900 hover:underline">{person.displayName}</a
								>
								{#if person.birthDate || person.deathDate}
									<span class="text-stone-600">
										{person.birthDate ?? '?'}–{person.deathDate ?? ''}
									</span>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			{/each}
		</section>
	{/if}

	{#if stats.birthsByCentury.length > 0}
		<section
			aria-labelledby="births-by-century"
			class="rounded-xl border border-stone-200 bg-white p-4"
			data-testid="overview-centuries"
		>
			<h2 id="births-by-century" class="font-semibold text-stone-900">Births by century</h2>
			<p class="text-xs text-stone-600">People whose birth is dated to a single year.</p>
			<dl class="mt-3 space-y-1 text-sm">
				{#each stats.birthsByCentury as row (row.century)}
					<div class="grid grid-cols-[4rem_1fr_3rem] items-center gap-2">
						<dt class="text-stone-700">{row.century}s</dt>
						<dd class="h-3 rounded-sm bg-stone-100" aria-hidden="true">
							<div
								class="h-3 rounded-sm bg-emerald-700"
								style:width="{(row.people / widest) * 100}%"
							></div>
						</dd>
						<dd class="text-right text-stone-700 tabular-nums">{row.people.toLocaleString()}</dd>
					</div>
				{/each}
			</dl>
		</section>
	{/if}

	{#if stats.averageLifespanYears !== null || stats.topSurnames.length > 0}
		<section
			aria-labelledby="tree-figures"
			class="rounded-xl border border-stone-200 bg-white p-4"
			data-testid="overview-figures"
		>
			<h2 id="tree-figures" class="font-semibold text-stone-900">Figures</h2>
			<dl class="mt-2 space-y-2 text-sm">
				{#if stats.averageLifespanYears !== null}
					<div>
						<dt class="text-stone-600">Average lifespan</dt>
						<dd class="font-semibold text-stone-900">
							{plural(stats.averageLifespanYears, 'year', 'years')}
						</dd>
					</div>
				{/if}
				{#if stats.oldest}
					<div>
						<dt class="text-stone-600">Longest life recorded</dt>
						<dd>
							<a
								href={personPath(data.summary.tree, stats.oldest.id)}
								class="font-semibold text-emerald-900 hover:underline">{stats.oldest.name}</a
							>, {plural(stats.oldest.years, 'year', 'years')}
						</dd>
					</div>
				{/if}
				{#if stats.topSurnames.length > 0}
					<div>
						<dt class="text-stone-600">Most common surnames</dt>
						<dd>
							<ol class="mt-1 space-y-0.5">
								{#each stats.topSurnames as row (row.surname)}
									<li class="flex justify-between gap-2">
										<a
											href="{base}/people?surname={encodeURIComponent(row.surname)}"
											class="font-semibold text-emerald-900 hover:underline">{row.surname}</a
										>
										<span class="text-stone-600 tabular-nums">{row.people.toLocaleString()}</span>
									</li>
								{/each}
							</ol>
						</dd>
					</div>
				{/if}
			</dl>
		</section>
	{/if}
</div>
