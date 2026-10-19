<script lang="ts">
	import { ChevronRight } from '@lucide/svelte';
	import { personPath, unionPath } from '#lib/components/person/person-paths.js';
	import { getTreeContext } from '#lib/components/tree/tree-context.js';
	import type { AuditRecordDto } from '#lib/shared/change-audit.js';
	import { treePath } from '#lib/shared/tree-slug.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const { editor } = getTreeContext();

	const tree = $derived(data.summary.tree);
	const base = $derived(treePath(tree));
	const when = (ms: number) => new Date(ms).toLocaleString();
	const show = (value: unknown) =>
		value === null || value === undefined || value === ''
			? '—'
			: typeof value === 'string'
				? value
				: JSON.stringify(value);
	const hrefOf = (record: AuditRecordDto) =>
		record.entityType === 'person'
			? personPath(tree, record.entityId)
			: unionPath(tree, record.entityId);
	const olderHref = $derived(
		data.audit.nextBefore === null
			? null
			: `${base}/audit?before=${data.audit.nextBefore}${data.recordId ? `&record=${encodeURIComponent(data.recordId)}` : ''}`
	);
</script>

<svelte:head>
	<title>Audit log · {tree.name} · Epoch</title>
</svelte:head>

<header>
	<h2 class="text-2xl font-bold text-stone-900">Audit log</h2>
	<p class="mt-1 max-w-2xl text-sm text-stone-600">
		Every change made in the editor, newest first. A change can be undone if nothing has changed the
		same records since. Managers can undo anyone's; everyone else, their own.
	</p>
</header>

{#if data.recordId}
	<p class="mt-3 text-sm text-stone-700" data-testid="audit-filter">
		Showing changes to one record. <a href={`${base}/audit`} class="text-link">Show all changes</a>
	</p>
{/if}

{#if data.audit.entries.length === 0}
	<p class="mt-6 text-sm text-stone-600 italic">
		No changes are logged{data.recordId ? ' for this record' : ''}. Imported records have no
		history.
	</p>
{:else}
	<ul
		class="mt-4 divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white"
		data-testid="audit"
	>
		{#each data.audit.entries as entry (entry.id)}
			<li class="px-4 py-3 text-sm" data-testid="audit-entry">
				<div class="flex flex-wrap items-baseline justify-between gap-2">
					<span class="min-w-0">
						<span class="font-medium text-stone-900">{entry.summary}</span>
						<span class="block text-xs text-stone-600">
							{entry.actorName ?? 'Someone'} · {when(entry.createdAt)} ·
							<span class="font-mono">{entry.kind}</span>
						</span>
					</span>
					{#if entry.canUndo}
						<button
							type="button"
							class="text-link text-xs coarse:min-h-11"
							aria-label={`Undo: ${entry.summary}`}
							onclick={() => editor.undoChange(entry.id)}>Undo</button
						>
					{/if}
				</div>
				{#if entry.isUndone}
					<p class="mt-1 text-xs text-amber-900" data-testid="audit-undone">
						Undone by {entry.undoneByName ?? 'someone'}{entry.undoneAt
							? `, ${when(entry.undoneAt)}`
							: ''}.
					</p>
				{/if}
				{#if entry.records.length > 0}
					<details class="group mt-2">
						<summary
							class="flex w-fit cursor-pointer list-none items-center gap-1 rounded-lg text-xs text-stone-700 focus-ring coarse:min-h-11 [&::-webkit-details-marker]:hidden"
						>
							<ChevronRight
								class="h-4 w-4 text-stone-500 transition-transform group-open:rotate-90 motion-reduce:transition-none"
								aria-hidden="true"
							/>
							{entry.records.length}
							{entry.records.length === 1 ? 'record' : 'records'} changed
						</summary>
						<ul class="mt-2 space-y-2 text-xs">
							{#each entry.records as record (`${record.entityType}:${record.entityId}`)}
								<li>
									<span class="text-stone-800">
										{record.action}
										{record.entityType}
										{#if record.isLinkable}
											<a
												href={hrefOf(record)}
												class="font-semibold text-emerald-900 hover:underline">{record.label}</a
											>
										{:else}
											<span class="font-semibold">{record.label}</span>
										{/if}
									</span>
									{#if record.fields.length > 0}
										<dl class="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-stone-600">
											{#each record.fields as field (field.field)}
												<dt class="font-medium">{field.field}</dt>
												<dd>
													<span class="font-mono">{show(field.before)}</span>
													→
													<span class="font-mono text-emerald-900">{show(field.after)}</span>
												</dd>
											{/each}
										</dl>
									{/if}
								</li>
							{/each}
						</ul>
					</details>
				{/if}
			</li>
		{/each}
	</ul>
	{#if olderHref}
		<p class="mt-4">
			<a href={olderHref} class="text-link text-sm" data-testid="audit-older">Show older</a>
		</p>
	{/if}
{/if}
