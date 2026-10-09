<script lang="ts">
	import { invalidate } from '$app/navigation';
	import TaskDialog from '#lib/components/tasks/TaskDialog.svelte';
	import { canAddTask } from '#lib/components/tasks/task-permissions.js';
	import { getTreeContext } from '#lib/components/tree/tree-context.js';
	import { DATA_KEY } from '#lib/services/load-helpers.js';
	import {
		dismissFindingApi,
		previewStandardiseDatesApi,
		restoreFindingApi,
		standardiseDatesApi
	} from '#lib/services/tree-api.js';
	import type { DateTidyPreview } from '#lib/shared/date-tidy.js';
	import {
		MAX_DISMISSAL_REASON_LENGTH,
		MAX_FINDINGS_PER_RULE,
		QUALITY_RULES,
		QUALITY_RULE_BY_CODE,
		QUALITY_SEVERITY_LABELS,
		QUALITY_SEVERITY_ORDER,
		type FindingSubject,
		type QualityFinding
	} from '#lib/shared/quality.js';
	import { hasMinimumRole, isManagerOrAbove } from '#lib/shared/roles.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const { editor, toasts } = getTreeContext();

	const treeId = $derived(data.summary.tree.id);
	const base = $derived(`/trees/${encodeURIComponent(treeId)}`);
	const report = $derived(data.report);
	const role = $derived(data.trees.find((t) => t.id === treeId)?.role);
	const canDismiss = $derived(role !== undefined && hasMinimumRole(role, 'editor'));

	// Standardising sweeps every date in the tree, private people's included, so it is a manager's.
	const canStandardise = $derived(role !== undefined && isManagerOrAbove(role));
	let datePreview = $state<DateTidyPreview | null>(null);
	let isCheckingDates = $state(false);
	let isStandardising = $state(false);

	async function checkDates() {
		isCheckingDates = true;
		try {
			datePreview = await previewStandardiseDatesApi(treeId);
		} catch (cause: unknown) {
			toasts.push((cause as Error).message || 'Could not check the dates', {
				tone: 'error',
				durationMs: 10_000
			});
		} finally {
			isCheckingDates = false;
		}
	}

	async function standardiseDates() {
		isStandardising = true;
		try {
			const { change, remaining } = await standardiseDatesApi(treeId);
			await editor.afterChange(change, 'Dates standardised');
			// What is left is for another turn; show it rather than make the manager check again.
			datePreview = remaining > 0 ? await previewStandardiseDatesApi(treeId) : null;
		} catch (cause: unknown) {
			toasts.push((cause as Error).message || 'Could not standardise the dates', {
				tone: 'error',
				durationMs: 10_000
			});
		} finally {
			isStandardising = false;
		}
	}

	/** The finding a task is being made from. */
	let taskFor = $state<QualityFinding | null>(null);

	/** The record a task from a finding is about: the finding's first person or partnership, if it has one. */
	const taskSubjectOf = (finding: QualityFinding) => {
		const first = finding.subjects[0];
		return first
			? {
					ref: {
						kind: first.kind === 'person' ? ('person' as const) : ('union' as const),
						id: first.id
					},
					label: first.name
				}
			: null;
	};

	/** The finding whose reason is being written; one at a time keeps the page quiet. */
	let dismissing = $state<string | null>(null);
	let reason = $state('');
	let isSaving = $state(false);

	const total = $derived(Object.values(report.counts).reduce((sum, n) => sum + n, 0));
	const sections = $derived(
		QUALITY_SEVERITY_ORDER.map((severity) => ({
			severity,
			rules: QUALITY_RULES.filter((rule) => rule.severity === severity)
				.map((rule) => ({
					rule,
					count: report.counts[rule.code] ?? 0,
					findings: report.findings.filter((f) => f.rule === rule.code)
				}))
				.filter((group) => group.count > 0)
		})).filter((section) => section.rules.length > 0)
	);

	const subjectHref = (subject: FindingSubject) =>
		`${base}/${subject.kind === 'person' ? 'people' : 'unions'}/${encodeURIComponent(subject.id)}`;

	function startDismissing(finding: QualityFinding) {
		dismissing = finding.key;
		reason = '';
	}

	async function run(action: () => Promise<void>, done: string) {
		isSaving = true;
		try {
			await action();
			dismissing = null;
			await invalidate(DATA_KEY);
			toasts.push(done);
		} catch (cause: unknown) {
			toasts.push((cause as Error).message || 'Could not save', {
				tone: 'error',
				durationMs: 10_000
			});
		} finally {
			isSaving = false;
		}
	}
</script>

<svelte:head>
	<title>Data quality · {data.summary.tree.name} · Epoch</title>
</svelte:head>

<header>
	<h2 class="text-2xl font-bold text-stone-900">Data quality</h2>
	<p class="mt-1 max-w-2xl text-sm text-stone-600">
		Places where the record disagrees with itself, or where more research could help. A finding is a
		prompt to look, not a verdict: nothing here stops a save, and an unusual history can stand. A
		date counts against a rule only when it rules the history out.
	</p>
</header>

<p class="mt-4 text-sm font-semibold text-stone-800" data-testid="quality-total" aria-live="polite">
	{total === 0 ? 'No findings.' : `${total} ${total === 1 ? 'finding' : 'findings'}`}{report
		.dismissed.length > 0
		? `, ${report.dismissed.length} dismissed`
		: ''}
</p>

{#if canStandardise}
	<section
		class="mt-6 rounded-xl border border-stone-200 bg-white px-4 py-3"
		aria-labelledby="date-spellings"
		data-testid="date-spellings"
	>
		<h3 id="date-spellings" class="text-sm font-semibold text-stone-900">Date spellings</h3>
		<p class="mt-1 max-w-2xl text-xs text-stone-600">
			Dates from other programs are often spelt loosely, such as 3 RD DECEMBER 1996 or CIRCA 1937.
			Epoch reads them, but other programs may not. Standardising gives each one its GEDCOM
			spelling, without changing what it says. A date Epoch cannot read is never changed.
		</p>
		{#if datePreview === null}
			<button
				type="button"
				class="text-link mt-2 text-sm"
				disabled={isCheckingDates}
				onclick={checkDates}
			>
				{isCheckingDates ? 'Checking…' : 'Check date spellings'}
			</button>
		{:else if datePreview.changes.length === 0}
			<p class="mt-2 text-sm text-stone-800" aria-live="polite">
				Every date is already in its standard spelling.
			</p>
		{:else}
			<p class="mt-2 text-sm text-stone-800" aria-live="polite">
				{datePreview.changes.length}
				{datePreview.changes.length === 1 ? 'date' : 'dates'} would change{datePreview.remaining > 0
					? `, and ${datePreview.remaining} more after that`
					: ''}:
			</p>
			<div class="mt-2 max-h-72 overflow-y-auto rounded-lg border border-stone-200">
				<table class="w-full text-left text-xs">
					<thead class="sticky top-0 bg-stone-50 text-stone-600">
						<tr>
							<th scope="col" class="px-3 py-1.5 font-medium">On</th>
							<th scope="col" class="px-3 py-1.5 font-medium">Now</th>
							<th scope="col" class="px-3 py-1.5 font-medium">Becomes</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-stone-100">
						{#each datePreview.changes as row, i (i)}
							<tr>
								<td class="px-3 py-1.5 text-stone-800">{row.label}</td>
								<td class="px-3 py-1.5 font-mono text-stone-600">{row.before}</td>
								<td class="px-3 py-1.5 font-mono text-emerald-900">{row.after}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<div class="mt-2 flex flex-wrap items-center gap-3">
				<button
					type="button"
					class="rounded-lg bg-emerald-800 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
					disabled={isStandardising}
					onclick={standardiseDates}
				>
					{isStandardising
						? 'Standardising…'
						: `Standardise ${datePreview.changes.length === 1 ? '1 date' : `${datePreview.changes.length} dates`}`}
				</button>
				<button type="button" class="text-link text-sm" onclick={() => (datePreview = null)}>
					Not now
				</button>
				<span class="text-xs text-stone-500">One change: you can undo it straight afterwards.</span>
			</div>
		{/if}
	</section>
{/if}

{#snippet subjectLinks(finding: QualityFinding)}
	{#each finding.subjects as subject, i (subject.id)}{i > 0 ? ', ' : ''}<a
			href={subjectHref(subject)}
			class="font-semibold text-emerald-900 hover:underline">{subject.name}</a
		>{/each}
{/snippet}

{#each sections as section (section.severity)}
	<section class="mt-6" aria-labelledby="severity-{section.severity}">
		<h3 id="severity-{section.severity}" class="text-lg font-bold text-stone-900">
			{QUALITY_SEVERITY_LABELS[section.severity]}
		</h3>
		{#each section.rules as group (group.rule.code)}
			<div
				class="mt-3 rounded-xl border border-stone-200 bg-white"
				data-testid="rule-{group.rule.code}"
			>
				<div class="border-b border-stone-200 px-4 py-2">
					<h4 class="text-sm font-semibold text-stone-900">
						{group.rule.title} <span class="font-normal text-stone-600">({group.count})</span>
					</h4>
					<details class="text-xs text-stone-600">
						<summary class="cursor-pointer">Why this is flagged</summary>
						<p class="mt-1">{group.rule.why}</p>
					</details>
				</div>
				<ul class="divide-y divide-stone-100">
					{#each group.findings as finding (finding.key)}
						<li class="px-4 py-2 text-sm" data-testid="finding">
							<div class="flex flex-wrap items-baseline justify-between gap-2">
								<span class="text-stone-800"
									>{finding.message}
									<span class="text-xs text-stone-500">{@render subjectLinks(finding)}</span></span
								>
								<span class="flex items-baseline gap-3">
									{#if canAddTask(role) && !finding.task}
										<button
											type="button"
											class="text-link text-xs"
											onclick={() => (taskFor = finding)}
											aria-label={`Create a task for: ${finding.message}`}>Create task</button
										>
									{/if}
									{#if canDismiss && dismissing !== finding.key}
										<button
											type="button"
											class="text-link text-xs"
											onclick={() => startDismissing(finding)}>Dismiss</button
										>
									{/if}
								</span>
							</div>
							{#if finding.task}
								<p class="mt-1 text-xs text-stone-600" data-testid="finding-task">
									Has a task:
									<a
										href={`${base}/tasks?status=${finding.task.status}#task-${finding.task.id}`}
										class="text-link">{finding.task.title}</a
									>
									({finding.task.status})
								</p>
							{/if}
							{#if dismissing === finding.key}
								<form
									class="mt-2 flex flex-wrap items-end gap-2"
									onsubmit={(event) => {
										event.preventDefault();
										void run(
											() => dismissFindingApi(treeId, finding.key, reason),
											'Finding dismissed'
										);
									}}
								>
									<label class="text-xs font-semibold text-stone-700">
										Why is this fine?
										<input
											bind:value={reason}
											required
											maxlength={MAX_DISMISSAL_REASON_LENGTH}
											class="mt-1 block w-80 max-w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm font-normal"
										/>
									</label>
									<button
										type="submit"
										disabled={isSaving || !reason.trim()}
										class="rounded-lg bg-emerald-800 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
										>Dismiss</button
									>
									<button
										type="button"
										class="rounded-lg px-3 py-1.5 text-sm font-semibold text-stone-700 hover:bg-stone-100"
										onclick={() => (dismissing = null)}>Cancel</button
									>
								</form>
							{/if}
						</li>
					{/each}
				</ul>
				{#if group.count > group.findings.length}
					<p class="border-t border-stone-200 px-4 py-2 text-xs text-stone-600">
						The first {MAX_FINDINGS_PER_RULE} of {group.count} are shown. Dismiss or fix some to see the
						rest.
					</p>
				{/if}
			</div>
		{/each}
	</section>
{/each}

{#if report.dismissed.length > 0}
	<section class="mt-8" aria-labelledby="dismissed-heading">
		<h3 id="dismissed-heading" class="text-lg font-bold text-stone-900">Dismissed</h3>
		<ul
			class="mt-3 divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white"
			data-testid="dismissed"
		>
			{#each report.dismissed as item (item.key)}
				<li class="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2 text-sm">
					<span>
						<span class="text-stone-800">{item.finding.message}</span>
						<span class="block text-xs text-stone-600"
							>{QUALITY_RULE_BY_CODE.get(item.finding.rule)?.title}. “{item.reason}” — {item.dismissedBy},
							{new Date(item.dismissedAt).toLocaleDateString()}</span
						>
					</span>
					{#if canDismiss}
						<button
							type="button"
							class="text-link text-xs"
							disabled={isSaving}
							onclick={() => run(() => restoreFindingApi(treeId, item.key), 'Finding restored')}
							>Restore</button
						>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
{/if}

<TaskDialog
	isOpen={taskFor !== null}
	{treeId}
	task={null}
	subject={taskFor ? taskSubjectOf(taskFor) : null}
	findingKey={taskFor?.key ?? null}
	suggestedTitle={taskFor?.message ?? ''}
	members={report.members}
	onsaved={async (change) => {
		taskFor = null;
		await editor.afterChange(change, 'Task added');
	}}
	onstale={async () => {
		taskFor = null;
		await editor.refresh();
	}}
	oncancel={() => (taskFor = null)}
/>
