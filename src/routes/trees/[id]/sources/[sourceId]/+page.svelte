<script lang="ts">
	import { treeLinkSlug } from '#lib/shared/tree-slug.js';
	import { goto } from '$app/navigation';
	import { GitMerge, Pencil, Plus, Trash2 } from '@lucide/svelte';
	import { canCite, canChangeEvidence } from '#lib/components/evidence/evidence-permissions.js';
	import SourceFiles from '#lib/components/evidence/SourceFiles.svelte';
	import RepositoryLinkDialog from '#lib/components/evidence/RepositoryLinkDialog.svelte';
	import SourceDialog from '#lib/components/evidence/SourceDialog.svelte';
	import SourceMergeDialog from '#lib/components/evidence/SourceMergeDialog.svelte';
	import Pager from '#lib/components/lists/Pager.svelte';
	import NoteList from '#lib/components/notes/NoteList.svelte';
	import { NOTE_SUBJECT_KINDS } from '#lib/shared/notes.js';
	import { getTreeContext } from '#lib/components/tree/tree-context.js';
	import { deleteSourceApi, previewEvidenceApi, unlinkRepositoryApi } from '#lib/api/evidence.js';
	import {
		CITATION_QUALITY_LABELS,
		sourceLabel,
		type SourceRepositoryDto
	} from '#lib/shared/evidence.js';
	import type { PageProps } from './$types';
	import { treePath } from '#lib/shared/tree-slug.js';

	let { data }: PageProps = $props();
	const { editor, toasts } = getTreeContext();

	const source = $derived(data.source);
	const treeId = $derived(data.summary.tree.id);
	const base = $derived(treePath(data.summary.tree));
	const role = $derived(data.trees.find((t) => t.id === treeId)?.role);
	const title = $derived(sourceLabel(source));
	const pageHref = (offset: number) =>
		`${base}/sources/${encodeURIComponent(source.id)}${offset > 0 ? `?offset=${offset}` : ''}`;

	let isEditing = $state(false);
	let isMerging = $state(false);
	let linking = $state<{ link: SourceRepositoryDto | null } | null>(null);

	function remove() {
		const hasCitations = source.citationCount > 0;
		void editor.confirmWithImpact({
			title: hasCitations
				? `Delete “${title}” and its ${source.citationCount} ${source.citationCount === 1 ? 'citation' : 'citations'}?`
				: `Delete “${title}”?`,
			confirmLabel: hasCitations ? 'Delete source and citations' : 'Delete source',
			preview: () =>
				previewEvidenceApi(treeId, {
					kind: 'delete_source',
					sourceId: source.id,
					version: source.version,
					shouldRemoveCitations: true
				}),
			run: async () => {
				const result = await deleteSourceApi(treeId, source.id, {
					version: source.version,
					shouldRemoveCitations: true
				});
				await goto(`${base}/sources`, { replace: true });
				return result;
			},
			done: 'Source deleted'
		});
	}

	async function unlink(link: SourceRepositoryDto) {
		await editor.mutate(() => unlinkRepositoryApi(treeId, link.linkId, link.version), {
			done: 'Repository unlinked',
			failure: 'Could not unlink the repository'
		});
	}

	const hrefOf = (group: { personId: string | null; unionId: string | null }) =>
		group.personId
			? `${base}/people/${encodeURIComponent(group.personId)}`
			: group.unionId
				? `${base}/unions/${encodeURIComponent(group.unionId)}`
				: null;
</script>

<svelte:head>
	<title>{title} · Sources · Epoch</title>
</svelte:head>

<nav aria-label="Breadcrumb" class="text-xs text-stone-600">
	<a href={base} class="text-link">{data.summary.tree.name}</a>
	<span aria-hidden="true"> › </span>
	<a href={`${base}/sources`} class="text-link">Sources</a>
	<span aria-hidden="true"> › </span>
	<span aria-current="page">{title}</span>
</nav>

<header class="flex flex-wrap items-start justify-between gap-3">
	<div>
		<h2 class="text-2xl font-bold text-stone-900" data-testid="source-title">{title}</h2>
		<p class="mt-1 text-sm text-stone-600">
			{[
				source.author,
				source.publication,
				source.abbreviation && source.abbreviation !== title ? source.abbreviation : null
			]
				.filter(Boolean)
				.join(' · ') || 'No author or publication recorded'}
		</p>
	</div>
	{#if canChangeEvidence(role)}
		<div class="flex flex-wrap gap-2">
			<button type="button" class="action-btn" onclick={() => (isEditing = true)}
				><Pencil class="h-3.5 w-3.5" />Edit</button
			>
			<button type="button" class="action-btn" onclick={() => (isMerging = true)}
				><GitMerge class="h-3.5 w-3.5" />Merge…</button
			>
			<button type="button" class="action-btn text-red-700" onclick={remove}
				><Trash2 class="h-3.5 w-3.5" />Delete…</button
			>
		</div>
	{/if}
</header>

{#if source.text}
	<blockquote
		class="border-l-2 border-stone-300 pl-3 text-sm text-stone-700"
		data-testid="source-text"
	>
		{source.text}
	</blockquote>
{/if}

<div class="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
	<section aria-labelledby="cited-heading" class="section-card">
		<h3 id="cited-heading" class="section-heading">
			What it supports
			<span class="font-normal text-stone-500"
				>· {source.citationCount} {source.citationCount === 1 ? 'citation' : 'citations'}</span
			>
		</h3>
		{#if source.groups.length === 0}
			<p class="mt-2 text-xs text-stone-500 italic" data-testid="not-cited">
				Nothing you can see cites this source yet. Cite it from a fact, a name or a partnership.
			</p>
		{:else}
			<ul class="mt-3 space-y-3" data-testid="source-groups">
				{#each source.groups as group (group.subject.kind + group.subject.id)}
					<li data-testid="source-group">
						<p class="text-sm font-semibold text-stone-900">
							{#if hrefOf(group)}<a href={hrefOf(group)} class="text-link">{group.label}</a
								>{:else}{group.label}{/if}
						</p>
						<ul class="mt-1 space-y-1 text-xs text-stone-700">
							{#each group.citations as citation (citation.id)}
								<li>
									{[
										citation.page,
										citation.quality !== null ? CITATION_QUALITY_LABELS[citation.quality] : null,
										citation.entryDate ? `Recorded ${citation.entryDate}` : null
									]
										.filter(Boolean)
										.join(' · ') || 'No page or detail'}
									{#if citation.text}<span class="block text-stone-600">“{citation.text}”</span
										>{/if}
									{#each citation.notes as note (note.id)}<span
											class="block whitespace-pre-line text-stone-500"
											data-testid="citation-note">Note: {note.text}</span
										>{/each}
								</li>
							{/each}
						</ul>
					</li>
				{/each}
			</ul>
			<div class="mt-4">
				<Pager
					summary={`Showing ${source.offset + 1} to ${source.offset + source.groups.reduce((n, g) => n + g.citations.length, 0)} of ${source.citationCount}`}
					previousHref={source.offset > 0
						? pageHref(Math.max(0, source.offset - source.limit))
						: null}
					nextHref={source.hasMore ? pageHref(source.offset + source.limit) : null}
				/>
			</div>
		{/if}
	</section>

	<div class="space-y-6">
		<section aria-labelledby="kept-heading" class="section-card">
			<div class="flex items-center justify-between gap-3">
				<h3 id="kept-heading" class="section-heading">Where it is kept</h3>
				{#if canCite(role)}
					<button type="button" class="action-btn" onclick={() => (linking = { link: null })}
						><Plus class="h-3.5 w-3.5" />Add</button
					>
				{/if}
			</div>
			{#if source.repositories.length === 0}
				<p class="mt-2 text-xs text-stone-500 italic">No repository is recorded for this source.</p>
			{:else}
				<ul class="mt-2 space-y-2 text-sm" data-testid="source-repositories">
					{#each source.repositories as link (link.linkId)}
						<li>
							<span class="font-medium">{link.name}</span>
							{#if link.callNumber}<span class="text-xs text-stone-600">
									· call number {link.callNumber}</span
								>{/if}
							{#if link.address}<span class="block text-xs whitespace-pre-line text-stone-500"
									>{link.address}</span
								>{/if}
							{#if canChangeEvidence(role)}
								<span class="mt-0.5 flex gap-3 text-xs font-semibold">
									<button
										type="button"
										class="row-link"
										onclick={() => (linking = { link })}
										aria-label={`Change the call number at ${link.name}`}>Call number</button
									>
									<button
										type="button"
										class="row-link text-red-700"
										onclick={() => void unlink(link)}
										aria-label={`Unlink ${link.name}`}>Unlink</button
									>
								</span>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		{#if data.files !== null}
			<SourceFiles
				{treeId}
				sourceId={source.id}
				files={data.files}
				canManage={canChangeEvidence(role)}
				{editor}
			/>
		{/if}

		<section aria-labelledby="source-notes-heading" class="section-card" data-testid="source-notes">
			<h3 id="source-notes-heading" class="section-heading">Notes</h3>
			<div class="mt-2">
				<NoteList
					{treeId}
					treeSlug={treeLinkSlug(data.summary.tree)}
					{role}
					{editor}
					{toasts}
					subjectLabel="this source"
					subject={{ kind: NOTE_SUBJECT_KINDS.SOURCE, id: source.id }}
					notes={source.notes}
				/>
			</div>
		</section>

		{#if source.xref}
			<p class="text-xs text-stone-500">Record number {source.xref}</p>
		{/if}
	</div>
</div>

<SourceDialog
	isOpen={isEditing}
	{treeId}
	{source}
	onsaved={async (change) => {
		isEditing = false;
		await editor.afterChange(change, 'Source saved');
	}}
	onstale={async () => {
		isEditing = false;
		await editor.refresh();
	}}
	oncancel={() => (isEditing = false)}
/>

<SourceMergeDialog
	isOpen={isMerging}
	{treeId}
	survivor={{ id: source.id, version: source.version, label: title }}
	onmerged={async (change) => {
		isMerging = false;
		await editor.afterChange(change, 'Sources merged');
	}}
	oncancel={() => (isMerging = false)}
/>

<RepositoryLinkDialog
	isOpen={linking !== null}
	{treeId}
	sourceId={source.id}
	link={linking?.link ?? null}
	onsaved={async (change) => {
		linking = null;
		await editor.afterChange(change, 'Saved');
	}}
	onstale={async () => {
		linking = null;
		await editor.refresh();
	}}
	oncancel={() => (linking = null)}
/>
