<script lang="ts">
	import { untrack } from 'svelte';
	import { UserPlus, Baby, Heart, Sparkles, Cross, HeartCrack, Users } from '@lucide/svelte';
	import BaseModal from './BaseModal.svelte';
	import ConflictDialog from './ConflictDialog.svelte';
	import RelationshipTypeFields from './RelationshipTypeFields.svelte';
	import RelationshipPersonPicker from './RelationshipPersonPicker.svelte';
	import RelationshipSiblingParents from './RelationshipSiblingParents.svelte';
	import RelationshipUnionChooser from './RelationshipUnionChooser.svelte';
	import RelationshipDeathFields from './RelationshipDeathFields.svelte';
	import RelationshipEndUnionFields from './RelationshipEndUnionFields.svelte';
	import RelationshipPlanPreview from './RelationshipPlanPreview.svelte';
	import { createRelationshipDraft } from './relationship-draft.svelte.js';
	import { personName } from '#lib/shared/person-name.js';
	import type {
		ChangeSummary,
		RelationshipGraph,
		RelationshipKind,
		RelationshipPlan
	} from '#lib/types/genealogy.js';

	interface Props {
		/** Whether the dialog is open. */
		isOpen: boolean;
		treeId: string;
		/** The person who is the anchor/subject of this relationship edit. */
		anchor: { id: string; givenName: string | null; surname: string | null };
		/** The graph, for the anchor's version, partnerships and existing death. */
		graph: RelationshipGraph;
		/** Optional counterpart already known, selected when the dialog opens. */
		preselect?: { id: string; givenName: string | null; surname: string | null } | null;
		/** Which form to open on. */
		initialKind?: RelationshipKind;
		/** The partnership to preselect for "end partnership". */
		initialUnionId?: string | null;
		onclose: () => void;
		/** Called with the logged change after a successful save, so the caller can refresh and offer Undo. */
		onsaved: (change: ChangeSummary | null, plan: RelationshipPlan) => void;
		/** Reload the graph after a conflict so the next save starts from current versions. */
		onrefresh: () => Promise<void>;
	}

	let {
		isOpen,
		treeId,
		anchor,
		graph,
		preselect = null,
		initialKind = 'add_parent',
		initialUnionId = null,
		onclose,
		onsaved,
		onrefresh
	}: Props = $props();

	const rel = createRelationshipDraft(() => ({
		treeId,
		anchor,
		graph,
		preselect,
		initialKind,
		initialUnionId,
		onsaved,
		onrefresh
	}));

	const kinds: Array<{ v: RelationshipKind; label: string; icon: typeof UserPlus }> = [
		{ v: 'add_parent', label: 'Add parent', icon: UserPlus },
		{ v: 'add_child', label: 'Add child', icon: Baby },
		{ v: 'add_sibling', label: 'Add sibling', icon: Users },
		{ v: 'add_partner', label: 'Add partner', icon: Heart },
		{ v: 'record_death', label: 'Record death', icon: Cross },
		{ v: 'end_union', label: 'End partnership', icon: HeartCrack }
	];

	// Reset only when the dialog opens. Reading the graph inside `reset` must not make it re-run: the
	// graph reloads after every save, and a late reload would wipe what the person has typed.
	$effect(() => {
		if (isOpen) untrack(() => rel.reset());
	});

	// Preview from the server, so the sentence and records shown are the ones the save will write.
	$effect(() => {
		if (!isOpen) return;
		return rel.previewPlan();
	});
</script>

<BaseModal
	{isOpen}
	title={rel.kind === 'record_death'
		? 'Record death'
		: rel.kind === 'end_union'
			? 'End partnership'
			: 'Add relationship'}
	subtitle={personName(anchor)}
	icon={Sparkles}
	maxWidthClass="max-w-lg"
	{onclose}
	error={rel.submission.error}
>
	<div class="space-y-4">
		<div class="grid grid-cols-3 gap-1.5 sm:grid-cols-6" role="group" aria-label="What to record">
			{#each kinds as item (item.v)}
				<button
					type="button"
					onclick={() => rel.selectKind(item.v)}
					aria-pressed={rel.kind === item.v}
					class="flex cursor-pointer flex-col items-center gap-1 rounded-lg border p-2 text-[11px] leading-tight font-medium {rel.kind ===
					item.v
						? 'border-emerald-400 bg-emerald-100 text-emerald-900'
						: 'border-stone-300 bg-white text-stone-600'}"
				>
					<item.icon class="h-4 w-4" />
					{item.label}
				</button>
			{/each}
		</div>

		{#if rel.kind === 'add_parent' || rel.kind === 'add_child' || rel.kind === 'add_sibling'}
			<RelationshipTypeFields {rel} />
		{/if}

		{#if rel.kind === 'add_parent' || rel.kind === 'add_child' || rel.kind === 'add_partner' || (rel.kind === 'add_sibling' && rel.siblingOptions.length > 0)}
			<RelationshipPersonPicker {rel} />
		{/if}

		{#if rel.kind === 'add_sibling'}
			<RelationshipSiblingParents {rel} />
		{/if}

		{#if rel.shouldShowUnionChooser}
			<RelationshipUnionChooser {rel} />
		{/if}

		{#if rel.kind === 'record_death'}
			<RelationshipDeathFields {rel} />
		{/if}

		{#if rel.kind === 'end_union'}
			<RelationshipEndUnionFields {rel} />
		{/if}

		<RelationshipPlanPreview {rel} />

		<div class="flex gap-2">
			<button
				type="button"
				onclick={onclose}
				class="flex-1 cursor-pointer rounded-lg bg-stone-200 py-2 font-semibold text-stone-700"
				>Cancel</button
			>
			<button
				type="button"
				onclick={() => rel.submit()}
				disabled={!rel.canSave}
				class="btn-primary flex-1"
			>
				{rel.submission.isSaving ? 'Saving…' : 'Save'}
			</button>
		</div>
	</div>
</BaseModal>

<ConflictDialog
	isOpen={rel.conflict !== null}
	subject={rel.kind === 'record_death'
		? personName(anchor)
		: rel.chosenUnion
			? `Partnership ${rel.partnersLabel(rel.chosenUnion)}`
			: ''}
	rows={rel.conflictRows}
	isWorking={rel.submission.isSaving}
	onreload={() => rel.reloadAfterConflict()}
	onreapply={() => rel.reapplyAfterConflict()}
	oncancel={() => (rel.conflict = null)}
/>
