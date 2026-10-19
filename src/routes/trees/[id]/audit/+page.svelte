<script lang="ts">
	import { onMount } from 'svelte';
	import { ChevronRight } from '@lucide/svelte';
	import { personPath, unionPath } from '#lib/components/person/person-paths.js';
	import { getTreeContext } from '#lib/components/tree/tree-context.js';
	import Pager from '#lib/components/lists/Pager.svelte';
	import {
		AUDIT_PAGE_SIZE,
		type AuditFilters,
		type AuditRecordDto
	} from '#lib/shared/change-audit.js';
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
	const filters = $derived(data.filters);
	const audit = $derived(data.audit);

	/** The audit address for these filters; a page of 1 is left out so the first page has one address. */
	function addressFor(next: AuditFilters, page = 1) {
		const params = new URLSearchParams();
		if (next.recordId) params.set('record', next.recordId);
		if (next.actorId) params.set('actor', next.actorId);
		if (next.from) params.set('from', next.from);
		if (next.to) params.set('to', next.to);
		if (next.tz) params.set('tz', next.tz);
		if (page > 1) params.set('page', String(page));
		const query = params.toString();
		return `${base}/audit${query ? `?${query}` : ''}`;
	}
	const hrefFor = (page: number) => addressFor(filters, page);
	const actorName = $derived(audit.actors.find((a) => a.id === filters.actorId)?.name ?? 'someone');
	const isFiltered = $derived(
		Boolean(filters.recordId || filters.actorId || filters.from || filters.to)
	);
	// Set after mount: the form cannot know the reader's zone until the browser runs.
	let tz = $state('');
	onMount(() => (tz = Intl.DateTimeFormat().resolvedOptions().timeZone));
	const first = $derived((audit.page - 1) * AUDIT_PAGE_SIZE + 1);
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

<form
	method="GET"
	action={`${base}/audit`}
	class="mt-4 flex flex-wrap items-end gap-3 text-xs font-semibold text-stone-700"
	data-testid="audit-filters"
>
	{#if filters.recordId}<input type="hidden" name="record" value={filters.recordId} />{/if}
	<input type="hidden" name="tz" value={tz || (filters.tz ?? '')} />
	<label>
		Made by
		<select
			name="actor"
			class="mt-1 block rounded-lg border border-stone-300 px-2 py-1.5 text-sm font-normal coarse:min-h-11"
			value={filters.actorId ?? ''}
		>
			<option value="">Anyone</option>
			{#each audit.actors as actor (actor.id)}
				<option value={actor.id}>{actor.name}</option>
			{/each}
		</select>
	</label>
	<label>
		From
		<input
			type="date"
			name="from"
			value={filters.from ?? ''}
			class="mt-1 block rounded-lg border border-stone-300 px-2 py-1.5 text-sm font-normal coarse:min-h-11"
		/>
	</label>
	<label>
		To
		<input
			type="date"
			name="to"
			value={filters.to ?? ''}
			class="mt-1 block rounded-lg border border-stone-300 px-2 py-1.5 text-sm font-normal coarse:min-h-11"
		/>
	</label>
	<button type="submit" class="btn-primary-sm coarse:min-h-11">Filter</button>
	<span class="font-normal text-stone-500"
		>Days are in {audit.timeZone} time, both ends included.</span
	>
</form>

{#if isFiltered}
	<p class="mt-3 text-sm text-stone-700" data-testid="audit-filter">
		Showing
		{#if filters.recordId}changes to one record{:else}all changes{/if}{#if filters.actorId}
			made by {actorName}{/if}{#if filters.from || filters.to}, {filters.from
				? `from ${filters.from}`
				: ''}{filters.from && filters.to ? ' ' : ''}{filters.to ? `to ${filters.to}` : ''}{/if}.
		{#if filters.recordId}
			<a href={addressFor({ ...filters, recordId: null })} class="text-link">Show all records</a>
			·
		{/if}
		<a href={`${base}/audit`} class="text-link" data-testid="audit-clear">Clear filters</a>
	</p>
{/if}

{#if audit.entries.length === 0}
	<p class="mt-6 text-sm text-stone-600 italic" data-testid="audit-empty">
		{#if isFiltered}
			No changes match these filters.
		{:else}
			No changes are logged. Imported records have no history.
		{/if}
	</p>
{:else}
	<ul
		class="mt-4 divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white"
		data-testid="audit"
	>
		{#each audit.entries as entry (entry.id)}
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
	{#if audit.pageCount > 1}
		<div class="mt-4" data-testid="audit-pager">
			<Pager
				summary={`Showing ${first} to ${first + audit.entries.length - 1} of ${audit.total}`}
				previousHref={audit.page > 1 ? hrefFor(audit.page - 1) : null}
				nextHref={audit.page < audit.pageCount ? hrefFor(audit.page + 1) : null}
				pages={{ current: audit.page, count: audit.pageCount, hrefFor }}
			/>
		</div>
	{/if}
{/if}
