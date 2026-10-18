<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ToastStore } from '#lib/components/feedback/toasts.svelte.js';
	import type { TreeEditor } from '#lib/components/tree/tree-editor.svelte.js';
	import {
		CLAIM_STATES,
		claimStateOf,
		type CitationDto,
		type CitationSubjectRef
	} from '#lib/shared/evidence.js';
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
		/**
		 * Offers a quiet "Add source" link while there are no citations. Off where an edit dialog has
		 * its own Source section (facts, names), so the way in is not offered twice.
		 */
		isAddLinkShown?: boolean;
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
		controls,
		isAddLinkShown = true
	}: Props = $props();

	const claim = $derived(claimStateOf({ citationCount, isConflicting }));
	const canAdd = $derived(isAddLinkShown && citationCount === 0 && canCite(role));
	const citationNoun = $derived(citationCount === 1 ? 'citation' : 'citations');

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
	A sourced claim shows a quote icon and count that opens its citations; an unsourced one shows
	nothing, because that is the normal state. Citing a claim with nothing yet happens in the edit
	dialog, or through the quiet Add source link where there is no dialog. The controls share the
	line, the open list wraps to a row of its own, and an empty line takes no space.
-->
<div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs empty:hidden">
	{#if citationCount > 0}
		<details class="group open:basis-full" data-testid="citations-disclosure">
			<summary
				class="inline-flex cursor-pointer list-none items-center rounded text-stone-600 focus-ring group-open:text-emerald-800 hover:text-emerald-800 coarse:min-h-11 coarse:min-w-11 [&::-webkit-details-marker]:hidden"
				aria-label={`${citationCount} ${citationNoun} for ${label}`}
			>
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
	{:else if claim === CLAIM_STATES.CONFLICTING}
		<ClaimStateMarker state={claim} {citationCount} />
	{/if}
	{@render controls?.()}
	{#if canAdd}
		<button
			type="button"
			class="row-link coarse:min-h-11"
			onclick={() => (isAdding = true)}
			aria-label={`Add a source for ${subjectLabel}`}
			data-testid="add-citation">Add source</button
		>
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
	{/if}
</div>
