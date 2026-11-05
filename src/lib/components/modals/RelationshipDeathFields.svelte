<script lang="ts">
	import PlaceInput from '#lib/components/forms/PlaceInput.svelte';
	import DateInput from '#lib/components/forms/DateInput.svelte';
	import type { RelationshipDraft } from './relationship-draft.svelte.js';

	interface Props {
		/** The dialog's shared draft. */
		rel: RelationshipDraft;
	}

	let { rel }: Props = $props();
</script>

<div class="space-y-2">
	<label class="block text-xs font-semibold text-stone-700" for="death-date">Date of death</label>
	<DateInput
		id="death-date"
		bind:value={rel.deathDate}
		placeholder="e.g. 3 MAR 2001, ABT 1900, BET 1950 AND 1955"
		inputClass="w-full rounded-lg border border-stone-300 bg-white p-2 text-sm"
	/>
	<label class="block text-xs font-semibold text-stone-700" for="death-place">Place of death</label>
	<PlaceInput
		id="death-place"
		treeId={rel.treeId}
		bind:value={rel.deathPlace}
		inputClass="field-input"
	/>
	<p class="text-[11px] text-stone-500">
		Leave both empty to record only that they have died. A death never ends or changes a
		partnership.
	</p>
</div>
