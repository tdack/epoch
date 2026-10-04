<script lang="ts">
	import { invalidate } from '$app/navigation';
	import TaskDialog from '#lib/components/tasks/TaskDialog.svelte';
	import { canAddTask } from '#lib/components/tasks/task-permissions.js';
	import { getTreeContext } from '#lib/components/tree/tree-context.js';
	import { DATA_KEY } from '#lib/services/load-helpers.js';
	import { dismissFindingApi, restoreFindingApi } from '#lib/services/tree-api.js';
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
	import { hasMinimumRole } from '#lib/shared/roles.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const { editor, toasts } = getTreeContext();

	const treeId = $derived(data.summary.tree.id);
	const base = $derived(`/trees/${encodeURIComponent(treeId)}`);
	const report = $derived(data.report);
	const role = $derived(data.trees.find((t) => t.id === treeId)?.role);
	const canDismiss = $derived(role !== undefined && hasMinimumRole(role, 'editor'));

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
