<script lang="ts">
	import { Heart, Plus, Trash2 } from '@lucide/svelte';
	import { messageOf } from '#lib/components/feedback/error-message.js';
	import BaseModal from './BaseModal.svelte';
	import ConflictDialog from './ConflictDialog.svelte';
	import { differingRows } from './conflict.js';
	import { updateUnionApi, isConflict, type ConflictError } from '#lib/api/tree-api.js';
	import {
		UNION_EVENT_LABELS,
		UNION_EVENT_TYPE_LIST,
		UNION_STATUS_LABELS,
		type UnionEventType
	} from '#lib/shared/union-events.js';
	import type { PartnershipLabel } from '#lib/shared/partnership-labels.js';
	import DateInput from '#lib/components/forms/DateInput.svelte';
	import { checkDateEdit } from '#lib/shared/date-value.js';
	import type { ChangeSummary, RelationshipGraphUnion } from '#lib/types/genealogy.js';

	interface Props {
		/** Whether the dialog is open. */
		isOpen: boolean;
		treeId: string;
		/** The partnership being edited, as the graph has it now (with its version and events). */
		union: RelationshipGraphUnion | null;
		/** Chronological label when the pair has several partnerships ("2nd partnership (m. 1990)"). */
		label?: PartnershipLabel | null;
		/** Display name for a person id. */
		nameOf: (personId: string) => string;
		onclose: () => void;
		onsaved: (change: ChangeSummary | null) => void;
		/** Reload the graph so `union` is current after a conflict. */
		onrefresh: () => Promise<void>;
	}

	let {
		isOpen,
		treeId,
		union,
		label = null,
		nameOf,
		onclose,
		onsaved,
		onrefresh
	}: Props = $props();

	interface EventRow {
		key: number;
		id: string | null;
		type: UnionEventType;
		dateText: string;
		/** The date as saved, so one Epoch cannot read is kept rather than refused. */
		savedDateText: string;
		place: string;
	}

	let status = $state<string>('active');
	let rows = $state<EventRow[]>([]);
	let nextKey = 0;
	let isSubmitting = $state(false);
	let error = $state<string | null>(null);
	let conflict = $state<ConflictError | null>(null);
	let addType = $state<UnionEventType | ''>('');

	const title = $derived(
		union
			? [union.partnerIds.map(nameOf).join(' & ') || 'Partnership', label?.full]
					.filter(Boolean)
					.join(' · ')
			: 'Partnership'
	);
	const childIds = $derived([...new Set((union?.children ?? []).map((c) => c.childId))]);
	const unusedTypes = $derived(
		UNION_EVENT_TYPE_LIST.filter((t) => !rows.some((r) => r.type === t))
	);

	function load() {
		status = union?.status ?? 'active';
		rows = (union?.events ?? []).map((e) => ({
			key: nextKey++,
			id: e.id,
			type: e.type,
			dateText: e.dateText ?? '',
			savedDateText: e.dateText ?? '',
			place: e.place ?? ''
		}));
		error = null;
		conflict = null;
		addType = '';
	}

	$effect(() => {
		if (isOpen) load();
	});

	function addRow() {
		if (!addType) return;
		rows = [
			...rows,
			{ key: nextKey++, id: null, type: addType, dateText: '', savedDateText: '', place: '' }
		];
		addType = '';
	}

	interface StoredEvent {
		id: string;
		type: UnionEventType;
		dateText: string | null;
		place: string | null;
	}

	function payloadFor(version: number, mergeOnto?: ConflictError) {
		let events = rows.map((r) => ({
			id: r.id,
			type: r.type,
			dateText: r.dateText.trim() || null,
			place: r.place.trim() || null
		}));
		if (mergeOnto) {
			// Re-applying keeps what the other person did: my events map onto theirs by type, and any event
			// of a type I never had stays exactly as they saved it.
			const stored = (mergeOnto.details.current.events ?? []) as StoredEvent[];
			events = events.map((e) => ({ ...e, id: stored.find((s) => s.type === e.type)?.id ?? null }));
			for (const theirs of stored) {
				if (!rows.some((r) => r.type === theirs.type)) {
					events.push({
						id: theirs.id,
						type: theirs.type,
						dateText: theirs.dateText,
						place: theirs.place
					});
				}
			}
		}
		return { version, status, events };
	}

	const hasDateProblem = $derived(
		rows.some((r) => !checkDateEdit(r.dateText, r.savedDateText).isValid)
	);

	async function save(mergeOnto?: ConflictError) {
		if (!union) return;
		isSubmitting = true;
		error = null;
		try {
			const { change } = await updateUnionApi(
				treeId,
				union.id,
				payloadFor(mergeOnto?.details.currentVersion ?? union.version ?? 0, mergeOnto)
			);
			conflict = null;
			onsaved(change);
		} catch (e) {
			if (isConflict(e)) conflict = e;
			else error = messageOf(e, '');
		} finally {
			isSubmitting = false;
		}
	}

	const conflictRows = $derived.by(() => {
		if (!conflict) return [];
		const current = conflict.details.current as {
			status: string;
			events: Array<{ type: UnionEventType; dateText: string | null; place: string | null }>;
		};
		const fields = [
			{
				label: 'Status',
				yours: UNION_STATUS_LABELS[status as keyof typeof UNION_STATUS_LABELS] ?? status,
				current:
					UNION_STATUS_LABELS[current.status as keyof typeof UNION_STATUS_LABELS] ?? current.status
			}
		];
		for (const type of UNION_EVENT_TYPE_LIST) {
			const mine = rows.find((r) => r.type === type);
			const theirs = current.events.find((e) => e.type === type);
			if (!mine && !theirs) continue;
			const describe = (date?: string | null, place?: string | null, isPresent = true) =>
				isPresent ? [date, place].filter(Boolean).join(', ') || 'recorded, no details' : '';
			fields.push({
				label: UNION_EVENT_LABELS[type],
				yours: describe(mine?.dateText, mine?.place, Boolean(mine)),
				current: describe(theirs?.dateText, theirs?.place, Boolean(theirs))
			});
		}
		return differingRows(fields);
	});

	async function reload() {
		conflict = null;
		await onrefresh();
		load();
	}
</script>

<BaseModal
	{isOpen}
	title="Edit partnership"
	subtitle={title}
	icon={Heart}
	maxWidthClass="max-w-xl"
	{error}
	{onclose}
>
	<form
		class="space-y-4"
		onsubmit={(e) => {
			e.preventDefault();
			void save();
		}}
	>
		<section
			aria-label="Who is in this partnership"
			class="rounded-lg border border-stone-200 bg-white p-3 text-sm"
			data-testid="union-members"
		>
			<p>
				<span class="text-xs font-semibold text-stone-700">Partners:</span>
				{union?.partnerIds.map(nameOf).join(' & ') || 'none recorded'}
			</p>
			{#if union && union.partnerIds.length === 1}
				<p class="mt-0.5 text-xs text-stone-500">
					Only one parent is recorded. Who the other parent was is not known to this tree.
				</p>
			{/if}
			<p class="mt-1">
				<span class="text-xs font-semibold text-stone-700">Children:</span>
				{childIds.map(nameOf).join(', ') || 'none recorded'}
			</p>
		</section>

		<div>
			<label for="union-status" class="field-label">Status</label>
			<select id="union-status" bind:value={status} class="field-input">
				{#each Object.entries(UNION_STATUS_LABELS) as [value, label] (value)}
					<option {value}>{label}</option>
				{/each}
			</select>
			<p class="mt-1 text-[11px] text-stone-500">
				Status is a record of the partnership. It does not depend on either partner's death.
			</p>
		</div>

		<fieldset class="space-y-2">
			<legend class="text-xs font-semibold text-stone-700">Events</legend>
			{#if rows.length === 0}
				<p class="text-xs text-stone-500 italic">No events recorded.</p>
			{/if}
			{#each rows as row (row.key)}
				<div
					class="grid grid-cols-[1fr_auto] items-end gap-2 rounded-lg border border-stone-200 bg-white p-2 sm:grid-cols-[7.5rem_1fr_1fr_auto]"
				>
					<span
						class="pb-2 text-sm font-medium text-stone-800 max-sm:col-start-1 max-sm:row-start-1"
						>{UNION_EVENT_LABELS[row.type]}</span
					>
					<div class="max-sm:col-span-2 max-sm:row-start-2">
						<label class="block text-[11px] text-stone-500" for="ev-date-{row.key}">Date</label>
						<DateInput
							id="ev-date-{row.key}"
							bind:value={row.dateText}
							savedValue={row.savedDateText}
							placeholder="e.g. 12 MAR 1999"
							inputClass="w-full rounded-md border border-stone-300 p-1.5 text-sm"
						/>
					</div>
					<div class="max-sm:col-span-2 max-sm:row-start-3">
						<label class="block text-[11px] text-stone-500" for="ev-place-{row.key}">Place</label>
						<input
							id="ev-place-{row.key}"
							type="text"
							bind:value={row.place}
							class="w-full rounded-md border border-stone-300 p-1.5 text-sm"
						/>
					</div>
					<button
						type="button"
						onclick={() => (rows = rows.filter((r) => r.key !== row.key))}
						aria-label="Remove {UNION_EVENT_LABELS[row.type].toLowerCase()} event"
						class="mb-0.5 cursor-pointer rounded-md p-1.5 text-red-700 hover:bg-red-50 max-sm:col-start-2 max-sm:row-start-1"
					>
						<Trash2 class="h-4 w-4" />
					</button>
				</div>
			{/each}

			{#if unusedTypes.length > 0}
				<div class="flex items-center gap-2">
					<label class="sr-only" for="union-add-event">Add an event</label>
					<select
						id="union-add-event"
						bind:value={addType}
						class="flex-1 rounded-lg border border-stone-300 bg-white p-2 text-sm"
					>
						<option value="">Add an event…</option>
						{#each unusedTypes as type (type)}
							<option value={type}>{UNION_EVENT_LABELS[type]}</option>
						{/each}
					</select>
					<button
						type="button"
						onclick={addRow}
						disabled={!addType}
						class="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium disabled:opacity-50"
					>
						<Plus class="h-4 w-4" /> Add
					</button>
				</div>
			{/if}
		</fieldset>

		<div class="flex gap-2">
			<button
				type="button"
				onclick={onclose}
				class="flex-1 cursor-pointer rounded-lg bg-stone-200 py-2 font-semibold text-stone-700"
				>Cancel</button
			>
			<button
				type="submit"
				disabled={isSubmitting || hasDateProblem}
				class="flex-1 cursor-pointer rounded-lg bg-emerald-700 py-2 font-semibold text-white disabled:opacity-50"
			>
				{isSubmitting ? 'Saving…' : 'Save'}
			</button>
		</div>
	</form>
</BaseModal>

<ConflictDialog
	isOpen={conflict !== null}
	subject={title}
	rows={conflictRows}
	isWorking={isSubmitting}
	onreload={reload}
	onreapply={() => save(conflict ?? undefined)}
	oncancel={() => (conflict = null)}
/>
