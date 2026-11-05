<script lang="ts">
	import type { RelationshipDraft } from './relationship-draft.svelte.js';

	interface Props {
		/** The dialog's shared draft. */
		rel: RelationshipDraft;
	}

	let { rel }: Props = $props();
</script>

<fieldset class="space-y-1.5" data-testid="union-chooser">
	<legend class="text-xs font-semibold text-stone-700">{rel.unionChooserLegend}</legend>
	{#each rel.unionOptions as option (option.id ?? 'new')}
		<label
			class="flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm {rel.selectedUnionId ===
			option.id
				? 'border-emerald-400 bg-emerald-50'
				: 'border-stone-200 bg-white'}"
		>
			<input
				type="radio"
				name="rel-union"
				data-union-id={option.id ?? 'new'}
				checked={rel.selectedUnionId === option.id}
				onchange={() => (rel.unionOverride = option.id)}
				class="mt-1"
			/>
			<span>
				{option.title}
				<span class="block text-xs text-stone-500">{option.detail}</span>
			</span>
		</label>
	{/each}
	{#if rel.unionOverride === undefined && rel.plan?.unionChoice?.reason}
		<p class="text-xs text-stone-600" data-testid="union-reason">{rel.plan.unionChoice.reason}</p>
	{/if}
</fieldset>
