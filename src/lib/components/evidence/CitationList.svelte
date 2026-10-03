<script lang="ts">
	import { ArrowDown, ArrowUp, Plus } from 'lucide-svelte';
	import type { ToastStore } from '#lib/components/feedback/toasts.svelte.js';
	import type { TreeEditor } from '#lib/components/tree/tree-editor.svelte.js';
	import {
		CITATION_QUALITY_LABELS,
		type CitationDto,
		type CitationSubjectRef
	} from '#lib/shared/evidence.js';
	import {
		previewEvidenceApi,
		removeCitationApi,
		reorderCitationsApi
	} from '#lib/services/tree-api.js';
	import type { TreeRole } from '#lib/shared/roles.js';
	import CitationDialog from './CitationDialog.svelte';
	import { canChangeEvidence, canCite } from './evidence-permissions.js';

	interface Props {
		treeId: string;
		role: TreeRole | undefined;
		/** What these citations support, in words: "the birth of Ann Ash". */
		subjectLabel: string;
		subject: CitationSubjectRef;
		/** This record's citations, in the order they are kept. */
		citations: CitationDto[];
		editor: TreeEditor;
		toasts: ToastStore;
	}

	let { treeId, role, subjectLabel, subject, citations, editor, toasts }: Props = $props();

	let dialog = $state<{ citation: CitationDto | null } | null>(null);

	async function saved(change: Parameters<typeof editor.afterChange>[0]) {
		dialog = null;
		await editor.afterChange(change, 'Citation saved');
	}

	async function stale(message: string) {
		dialog = null;
		await editor.refresh();
		toasts.push(`${message} Review the citation and try again.`, {
			tone: 'error',
			durationMs: 10_000
		});
	}

	function remove(citation: CitationDto) {
		void editor.confirmWithImpact({
			title: `Remove this citation of “${citation.sourceLabel}”?`,
			confirmLabel: 'Remove citation',
			preview: () =>
				previewEvidenceApi(treeId, {
					kind: 'remove_citation',
					citationId: citation.id,
					version: citation.version
				}),
			run: () => removeCitationApi(treeId, citation.id, citation.version),
			done: 'Citation removed'
		});
	}

	async function move(index: number, by: -1 | 1) {
		const order = citations.map((c) => c.id);
		[order[index], order[index + by]] = [order[index + by]!, order[index]!];
		await editor.mutate(() => reorderCitationsApi(treeId, subject, order), {
			done: 'Citations reordered',
			failure: 'Could not reorder'
		});
	}
</script>

{#if citations.length === 0}
	<p class="text-xs text-stone-600 italic" data-testid="no-citations">
		No source is cited for {subjectLabel}.
	</p>
{:else}
	<ol class="space-y-2" data-testid="citations" aria-label={`Citations for ${subjectLabel}`}>
		{#each citations as citation, index (citation.id)}
			<li class="rounded-lg border border-stone-200 bg-stone-50 p-2 text-xs" data-testid="citation">
				<p class="font-semibold text-stone-900">
					{#if citation.sourceId}<a
							href={`/trees/${encodeURIComponent(treeId)}/sources/${encodeURIComponent(citation.sourceId)}`}
							class="text-link">{citation.sourceLabel}</a
						>{:else}{citation.sourceLabel}{/if}{#if citation.page}<span
							class="font-normal text-stone-700"
						>
							· {citation.page}</span
						>{/if}
				</p>
				{#if citation.quality !== null || citation.entryDate}
					<p class="mt-0.5 text-stone-600">
						{[
							citation.quality !== null ? CITATION_QUALITY_LABELS[citation.quality] : null,
							citation.entryDate ? `Recorded ${citation.entryDate}` : null
						]
							.filter(Boolean)
							.join(' · ')}
					</p>
				{/if}
				{#if citation.text}<blockquote class="mt-1 border-l-2 border-stone-300 pl-2 text-stone-700">
						{citation.text}
					</blockquote>{/if}
				{#if canChangeEvidence(role)}
					<div class="mt-1.5 flex flex-wrap items-center gap-3 font-semibold">
						<button
							type="button"
							class="row-link"
							onclick={() => (dialog = { citation })}
							aria-label={`Edit the citation of ${citation.sourceLabel}`}>Edit</button
						>
						<button
							type="button"
							class="row-link text-red-700"
							onclick={() => remove(citation)}
							aria-label={`Remove the citation of ${citation.sourceLabel}`}>Remove</button
						>
						{#if index > 0}
							<button
								type="button"
								class="row-link"
								onclick={() => void move(index, -1)}
								aria-label={`Move the citation of ${citation.sourceLabel} up`}
								><ArrowUp class="inline h-3 w-3" /></button
							>
						{/if}
						{#if index < citations.length - 1}
							<button
								type="button"
								class="row-link"
								onclick={() => void move(index, 1)}
								aria-label={`Move the citation of ${citation.sourceLabel} down`}
								><ArrowDown class="inline h-3 w-3" /></button
							>
						{/if}
					</div>
				{/if}
			</li>
		{/each}
	</ol>
{/if}
{#if canCite(role)}
	<button
		type="button"
		class="action-btn mt-2"
		onclick={() => (dialog = { citation: null })}
		aria-label={`Add a citation for ${subjectLabel}`}
		><Plus class="h-3.5 w-3.5" />Add citation</button
	>
{/if}

<CitationDialog
	isOpen={dialog !== null}
	{treeId}
	{subjectLabel}
	{subject}
	citation={dialog?.citation ?? null}
	onsaved={saved}
	onstale={stale}
	oncancel={() => (dialog = null)}
/>
