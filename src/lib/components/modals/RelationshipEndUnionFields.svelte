<script lang="ts">
	import PlaceInput from '#lib/components/forms/PlaceInput.svelte';
	import DateInput from '#lib/components/forms/DateInput.svelte';
	import { personName } from '#lib/shared/person-name.js';
	import {
		END_EVENT_TYPES,
		ENDED_UNION_STATUSES,
		UNION_EVENT_LABELS,
		UNION_STATUS_LABELS,
		type EndedUnionStatus
	} from '#lib/shared/union-events.js';
	import type { RelationshipDraft } from './relationship-draft.svelte.js';

	interface Props {
		/** The dialog's shared draft. */
		rel: RelationshipDraft;
	}

	let { rel }: Props = $props();
</script>

{#if rel.anchorUnions.length === 0}
	<p class="text-sm text-stone-600">{personName(rel.anchor)} has no partnership to end.</p>
{:else}
	<fieldset class="space-y-1.5">
		<legend class="text-xs font-semibold text-stone-700">Which partnership</legend>
		{#each rel.anchorUnions as union (union.id)}
			<label
				class="flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm {rel.effectiveUnionId ===
				union.id
					? 'border-emerald-400 bg-emerald-50'
					: 'border-stone-200 bg-white'}"
			>
				<input
					type="radio"
					name="end-union"
					value={union.id}
					checked={rel.effectiveUnionId === union.id}
					onchange={() => (rel.chosenUnionId = union.id)}
					class="mt-1"
				/>
				<span>
					{rel.partnersLabel(union)}
					<span class="block text-xs text-stone-500">
						{UNION_STATUS_LABELS[union.status]}{union.marriageDate
							? ` · married ${union.marriageDate}`
							: ''}
					</span>
				</span>
			</label>
		{/each}
	</fieldset>

	<div class="grid grid-cols-2 gap-3">
		<div>
			<label class="block text-xs font-semibold text-stone-700" for="end-status">Status</label>
			<select
				id="end-status"
				value={rel.endStatus}
				onchange={(e) => rel.pickStatus(e.currentTarget.value as EndedUnionStatus)}
				class="field-input"
			>
				{#each ENDED_UNION_STATUSES as status (status)}
					<option value={status}>{UNION_STATUS_LABELS[status]}</option>
				{/each}
			</select>
		</div>
		<div>
			<label class="block text-xs font-semibold text-stone-700" for="end-event"
				>Record an event</label
			>
			<select id="end-event" bind:value={rel.endEventType} class="field-input">
				<option value="">No event</option>
				{#each END_EVENT_TYPES as eventType (eventType)}
					<option value={eventType}>{UNION_EVENT_LABELS[eventType]}</option>
				{/each}
			</select>
		</div>
	</div>
	{#if rel.endEventType}
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label class="block text-xs font-semibold text-stone-700" for="end-date">Date</label>
				<DateInput
					id="end-date"
					bind:value={rel.endDate}
					inputClass="w-full rounded-lg border border-stone-300 bg-white p-2 text-sm"
				/>
			</div>
			<div>
				<label class="block text-xs font-semibold text-stone-700" for="end-place">Place</label>
				<PlaceInput
					id="end-place"
					treeId={rel.treeId}
					bind:value={rel.endPlace}
					inputClass="field-input"
				/>
			</div>
		</div>
	{/if}
{/if}
