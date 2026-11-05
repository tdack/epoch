<script lang="ts">
	import { personName } from '#lib/shared/person-name.js';
	import type { RelationshipDraft } from './relationship-draft.svelte.js';

	interface Props {
		/** The dialog's shared draft. */
		rel: RelationshipDraft;
	}

	let { rel }: Props = $props();
</script>

{#if rel.siblingOptions.length === 0}
	<p
		class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
		data-testid="sibling-needs-parent"
	>
		{personName(rel.anchor)} has no parents recorded, and a sibling is someone who shares a parent. Add
		a parent first.
	</p>
{:else}
	<fieldset class="space-y-1.5" data-testid="sibling-parents">
		<legend class="text-xs font-semibold text-stone-700">Which parents do they share</legend>
		{#each rel.siblingOptions as option (option.key)}
			<label
				class="flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm {rel.effectiveSiblingKey ===
				option.key
					? 'border-emerald-400 bg-emerald-50'
					: 'border-stone-200 bg-white'}"
			>
				<input
					type="radio"
					name="rel-sibling-parents"
					checked={rel.effectiveSiblingKey === option.key}
					onchange={() => (rel.siblingOptionKey = option.key)}
					class="mt-1"
				/>
				<span>
					{option.title}
					<span class="block text-xs text-stone-500">{option.detail}</span>
				</span>
			</label>
		{/each}
	</fieldset>
{/if}
