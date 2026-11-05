<script lang="ts">
	import { roleOptions, typeOptions, type RelationshipDraft } from './relationship-draft.svelte.js';

	interface Props {
		/** The dialog's shared draft. */
		rel: RelationshipDraft;
	}

	let { rel }: Props = $props();
</script>

<div class="space-y-2">
	<label class="block text-xs font-semibold text-stone-700" for="rel-type">Relationship type</label>
	<select id="rel-type" bind:value={rel.type} class="field-input">
		{#each typeOptions as t (t.value)}
			<option value={t.value}>{t.label}</option>
		{/each}
	</select>
	{#if rel.kind === 'add_parent'}
		<label class="block text-xs font-semibold text-stone-700" for="rel-role">Role</label>
		<select id="rel-role" bind:value={rel.role} class="field-input">
			{#each roleOptions as r (r.value)}
				<option value={r.value}>{r.label}</option>
			{/each}
		</select>
	{/if}
</div>
