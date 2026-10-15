<script lang="ts">
	import { untrack } from 'svelte';
	import { messageOf } from '#lib/components/feedback/error-message.js';
	import ImpactDialog from './ImpactDialog.svelte';
	import { defaultSurvivor, type MergeCandidate } from '#lib/components/tree/merge-candidates.js';
	import {
		UNION_EVENT_LABELS,
		UNION_STATUS_LABELS,
		isUnionEventType
	} from '#lib/shared/union-events.js';
	import type { MergeChoices, MergeConflict, MergeFact } from '#lib/shared/union-merge.js';
	import type { MergeUnionsRequest } from '#lib/api/relationships.js';
	import type { MergePreviewResponse } from '#lib/shared/api-contracts.js';

	interface Props {
		/** Whether the dialog is open. */
		isOpen: boolean;
		/** The shared partners, e.g. "John Smith and Jane Smith". */
		partners: string;
		/** The partnerships that could be merged, oldest first. At least two while `isOpen` is true. */
		candidates: MergeCandidate[];
		/** Ask the server what a merge would do. Rejects with a message that is shown in the dialog. */
		onpreview: (request: MergeUnionsRequest) => Promise<MergePreviewResponse>;
		/** Run the merge. Resolves when it is done; a rejection's message is shown in the dialog. */
		onconfirm: (request: MergeUnionsRequest) => Promise<void>;
		oncancel: () => void;
	}

	let { isOpen, partners, candidates, onpreview, onconfirm, oncancel }: Props = $props();

	let selectedIds = $state<string[]>([]);
	let survivorId = $state('');
	let keep = $state<MergeChoices>({});
	let preview = $state<MergePreviewResponse | null>(null);
	let isLoading = $state(false);
	let isConfirming = $state(false);
	let error = $state<string | null>(null);
	/** Only the newest preview may land, so a slow answer to an earlier choice cannot overwrite a later one. */
	let previewRequestNumber = 0;

	const groupName = `merge-${Math.random().toString(36).slice(2, 8)}`;
	const titleOf = (id: string) => candidates.find((c) => c.id === id)?.title ?? 'Partnership';

	const request = $derived<MergeUnionsRequest | null>(
		selectedIds.length >= 2 && selectedIds.includes(survivorId)
			? {
					survivorId,
					mergedIds: selectedIds.filter((id) => id !== survivorId),
					expectedVersions: Object.fromEntries(
						candidates.filter((c) => selectedIds.includes(c.id)).map((c) => [c.id, c.version])
					),
					keep
				}
			: null
	);

	const conflicts = $derived(preview?.conflicts ?? []);
	const isBlocked = $derived(request === null || preview?.impact == null);

	async function refresh() {
		const current = request;
		const number = ++previewRequestNumber;
		error = null;
		if (!current) {
			preview = null;
			return;
		}
		isLoading = true;
		try {
			const result = await onpreview(current);
			if (number === previewRequestNumber) preview = result;
		} catch (e) {
			if (number === previewRequestNumber) {
				preview = null;
				error = messageOf(e, 'Could not check what this merge does');
			}
		} finally {
			if (number === previewRequestNumber) isLoading = false;
		}
	}

	// Start each opening from every candidate selected and the fullest partnership kept, with no choices.
	// Only opening resets: reading the selection here would re-run this on every toggle and undo it.
	$effect(() => {
		if (!isOpen) return;
		untrack(() => {
			selectedIds = candidates.map((c) => c.id);
			survivorId = defaultSurvivor(candidates);
			keep = {};
			preview = null;
			isConfirming = false;
			void refresh();
		});
	});

	function toggle(id: string, isChecked: boolean) {
		selectedIds = isChecked ? [...selectedIds, id] : selectedIds.filter((s) => s !== id);
		if (!selectedIds.includes(survivorId)) survivorId = selectedIds[0] ?? '';
		// The conflicts belong to the chosen set, so choices made for another set no longer apply.
		keep = {};
		void refresh();
	}

	function chooseKept(conflict: MergeConflict, unionId: string) {
		keep =
			conflict.kind === 'status'
				? { ...keep, status: unionId }
				: { ...keep, events: { ...keep.events, [conflict.eventType]: unionId } };
		void refresh();
	}

	const chosenFor = (conflict: MergeConflict) =>
		conflict.kind === 'status' ? keep.status : keep.events?.[conflict.eventType];

	/**
	 * Two marriages that differ only by address must not read the same, so the imported details go in
	 * too, one line of text per fact (an address's line breaks become slashes).
	 */
	const factText = (facts: MergeFact[]) =>
		facts
			.map(
				(f) =>
					[
						f.dateText,
						f.place,
						f.description,
						f.classification && `type ${f.classification}`,
						f.address && `address ${f.address.split(/\r?\n/).join(' / ')}`,
						f.agency && `agency ${f.agency}`,
						f.religion && `religion ${f.religion}`,
						f.phone && `phone ${f.phone.split(/\r?\n/).join(', ')}`,
						f.email && `email ${f.email.split(/\r?\n/).join(', ')}`,
						f.web && `web ${f.web.split(/\r?\n/).join(', ')}`
					]
						.filter(Boolean)
						.join(', ') || 'no details'
			)
			.join('; ');

	const conflictTitle = (conflict: MergeConflict) =>
		conflict.kind === 'status'
			? 'These partnerships have different statuses. Which do you keep?'
			: `These partnerships record a different ${(isUnionEventType(conflict.eventType) ? UNION_EVENT_LABELS[conflict.eventType] : conflict.eventType).toLowerCase()}. Which do you keep?`;

	async function confirm() {
		if (!request) return;
		isConfirming = true;
		error = null;
		try {
			await onconfirm(request);
		} catch (e) {
			error = messageOf(e, 'That did not work');
			isConfirming = false;
		}
	}
</script>

{#snippet controls()}
	<p class="text-sm text-stone-700">
		Merge duplicate partnerships between {partners} into one. Children, events and every original XREF
		are kept.
	</p>

	<fieldset class="space-y-1.5">
		<legend class="text-xs font-bold tracking-wider text-stone-600 uppercase"
			>Partnerships to merge</legend
		>
		{#each candidates as candidate (candidate.id)}
			<div
				class="flex items-center gap-3 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-sm"
			>
				<label class="flex flex-1 cursor-pointer items-center gap-2">
					<input
						type="checkbox"
						checked={selectedIds.includes(candidate.id)}
						onchange={(event) => toggle(candidate.id, event.currentTarget.checked)}
					/>
					<span>
						{candidate.title}
						<span class="text-xs text-stone-500"
							>· {candidate.childCount} {candidate.childCount === 1 ? 'child' : 'children'}</span
						>
					</span>
				</label>
				<label class="flex cursor-pointer items-center gap-1 text-xs text-stone-600">
					<input
						type="radio"
						name="{groupName}-survivor"
						value={candidate.id}
						checked={survivorId === candidate.id}
						disabled={!selectedIds.includes(candidate.id)}
						onchange={() => {
							survivorId = candidate.id;
							void refresh();
						}}
					/>
					Keep this one
				</label>
			</div>
		{/each}
	</fieldset>

	{#each conflicts as conflict, index (index)}
		<fieldset class="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-2.5">
			<legend class="px-1 text-xs font-semibold text-amber-900">{conflictTitle(conflict)}</legend>
			{#each conflict.options as option (option.unionId)}
				<label class="flex cursor-pointer items-center gap-2 text-sm">
					<input
						type="radio"
						name="{groupName}-conflict-{index}"
						checked={chosenFor(conflict) === option.unionId}
						onchange={() => chooseKept(conflict, option.unionId)}
					/>
					<span>
						{titleOf(option.unionId)}:
						{'status' in option
							? UNION_STATUS_LABELS[option.status as keyof typeof UNION_STATUS_LABELS]
							: factText(option.facts)}
					</span>
				</label>
			{/each}
		</fieldset>
	{/each}
{/snippet}

<ImpactDialog
	{isOpen}
	title="Merge duplicate partnerships?"
	impact={preview?.impact ?? null}
	{isLoading}
	{isConfirming}
	{error}
	confirmLabel="Merge partnerships"
	{controls}
	isConfirmBlocked={isBlocked}
	idleMessage={request === null
		? 'Select at least two partnerships to merge.'
		: 'Choose which fact to keep above, and this will list exactly what changes.'}
	onconfirm={confirm}
	{oncancel}
/>
