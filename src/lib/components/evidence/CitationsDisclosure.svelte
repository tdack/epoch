<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Plus } from '@lucide/svelte';
	import type { ToastStore } from '#lib/components/feedback/toasts.svelte.js';
	import type { TreeEditor } from '#lib/components/tree/tree-editor.svelte.js';
	import { claimStateOf, type CitationDto, type CitationSubjectRef } from '#lib/shared/evidence.js';
	import type { TreeRole } from '#lib/shared/roles.js';
	import CitationDialog from './CitationDialog.svelte';
	import CitationList from './CitationList.svelte';
	import ClaimStateMarker from './ClaimStateMarker.svelte';
	import { citationSaved, citationStale } from './citation-changes.js';
	import { canCite } from './evidence-permissions.js';

	interface Props {
		treeId: string;
		/** The tree's slug, for the links the list builds (ADR-045); without one they use the id. */
		treeSlug?: string | null;
		role: TreeRole | undefined;
		/** What these citations support, in words: "the birth of Ann Ash". */
		subjectLabel: string;
		subject: CitationSubjectRef;
		/** This record's citations, in the order they are kept. */
		citations: CitationDto[];
		editor: TreeEditor;
		toasts: ToastStore;
		/** The record's citations; their number is the claim's evidence. */
		citationCount: number;
		/** Another fact of the same kind disagrees with this one. */
		isConflicting?: boolean;
		/** Names the disclosure for assistive tech: "the birth of Ann Ash". */
		label: string;
		/** Edit, remove and reorder buttons, drawn on the same line as the marker. */
		controls?: Snippet;
	}

	let {
		treeId,
		treeSlug = null,
		role,
		subjectLabel,
		subject,
		citations,
		editor,
		toasts,
		citationCount,
		isConflicting = false,
		label,
		controls
	}: Props = $props();

	const claim = $derived(claimStateOf({ citationCount, isConflicting }));
	const canAdd = $derived(citationCount === 0 && canCite(role));

	/** Set while the add dialog is open from an unsourced claim; the list has its own for edits. */
	let isAdding = $state(false);

	async function saved(change: Parameters<typeof editor.afterChange>[0]) {
		isAdding = false;
		await citationSaved(editor, change);
	}

	async function stale(message: string) {
		isAdding = false;
		await citationStale(editor, toasts, message);
	}
</script>

<!--
	The marker is the way in: with citations it opens them; without, an editor who can cite gets the
	Unsourced word as the button that adds one. The controls share the line, and the open list wraps
	to a row of its own, so they do not sit beside a long list.
-->
<div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
	{#if citationCount > 0}
		<details class="open:basis-full" data-testid="citations-disclosure">
			<summary class="flex cursor-pointer items-center gap-2" aria-label={`Citations for ${label}`}>
				<ClaimStateMarker state={claim} {citationCount} />
			</summary>
			<div class="mt-2">
				<CitationList
					{treeId}
					{treeSlug}
					{role}
					{editor}
					{toasts}
					{subjectLabel}
					{subject}
					{citations}
				/>
			</div>
		</details>
	{:else if canAdd}
		<button
			type="button"
			class="inline-flex cursor-pointer items-center gap-1 rounded focus-ring hover:underline coarse:min-h-11"
			onclick={() => (isAdding = true)}
			aria-label={`Add a citation for ${subjectLabel}`}
			data-testid="add-citation"
		>
			<ClaimStateMarker state={claim} citationCount={0} />
			<Plus class="h-3.5 w-3.5 text-emerald-800" aria-hidden="true" />
		</button>
		<CitationDialog
			isOpen={isAdding}
			{treeId}
			{subjectLabel}
			{subject}
			citation={null}
			onsaved={saved}
			onstale={stale}
			oncancel={() => (isAdding = false)}
		/>
	{:else}
		<ClaimStateMarker state={claim} citationCount={0} />
	{/if}
	{@render controls?.()}
</div>
