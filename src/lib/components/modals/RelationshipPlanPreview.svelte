<script lang="ts">
	import type { RelationshipDraft } from './relationship-draft.svelte.js';

	interface Props {
		/** The dialog's shared draft. */
		rel: RelationshipDraft;
	}

	let { rel }: Props = $props();
</script>

<!-- Server preview: the sentence and records the save will write -->
<div
	class="min-h-[3rem] rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"
	aria-live="polite"
>
	{#if rel.plan}
		<p class="font-medium">{rel.plan.sentence}</p>
		{#if rel.plan.impact && rel.plan.impact.records.length > 0}
			<ul class="mt-1.5 list-disc space-y-0.5 pl-5 text-xs text-emerald-800">
				{#each rel.plan.impact.records as record (record.entityType + record.entityId)}
					<li>
						{record.action === 'created'
							? 'Adds'
							: record.action === 'deleted'
								? 'Removes'
								: 'Changes'}
						{record.label}
					</li>
				{/each}
			</ul>
		{/if}
		{#if rel.plan.commands.length === 0}
			<p class="mt-1 text-xs font-semibold text-amber-800">Nothing would be saved.</p>
		{/if}
		{#each rel.plan.warnings as w (w.code + w.message)}
			<p class="mt-1 text-xs text-amber-800">{w.message}</p>
		{/each}
	{:else if rel.isPlanning}
		<p class="text-xs text-emerald-800">Checking…</p>
	{:else}
		<p class="text-xs text-emerald-800">The result will be described here before you save.</p>
	{/if}
</div>
