<script lang="ts">
	import PersonPicker from '#lib/components/PersonPicker.svelte';
	import SourcePicker from '#lib/components/evidence/SourcePicker.svelte';

	interface Props {
		/** The tree whose people and sources are offered. */
		treeId: string;
		/** Prefix for element ids, so two pickers on a page do not share them. */
		idPrefix: string;
		/**
		 * Whether a source may be chosen. A source is evidence, so the caller passes
		 * `canChangeEvidence(role)`; the server checks the write again.
		 */
		canPickSource: boolean;
		/** The person or source chosen, or null while none is. Two-way. */
		picked: { id: string; name: string } | null;
	}

	let { treeId, idPrefix, canPickSource, picked = $bindable() }: Props = $props();

	let kind = $state<'person' | 'source'>('person');
	let sourceId = $state<string | null>(null);
	let sourceName = $state('');
	let sourceError = $state<string | null>(null);

	// The source picker reports through bindings, so the choice is copied out here; the person
	// picker reports through a callback and needs no effect.
	$effect(() => {
		if (kind === 'source') picked = sourceId ? { id: sourceId, name: sourceName } : null;
	});

	function choose(next: 'person' | 'source') {
		if (next === kind) return;
		kind = next;
		picked = null;
		sourceId = null;
		sourceName = '';
		sourceError = null;
	}

	const tabClass = (isActive: boolean) =>
		`cursor-pointer rounded-md px-3 py-1 text-xs font-semibold focus-ring coarse:min-h-11 ${
			isActive ? 'bg-emerald-700 text-white' : 'text-stone-700 hover:bg-stone-200/70'
		}`;
</script>

<div class="space-y-3">
	{#if canPickSource}
		<div role="group" aria-label="Kind of record" class="flex gap-1">
			<button
				type="button"
				aria-pressed={kind === 'person'}
				class={tabClass(kind === 'person')}
				onclick={() => choose('person')}>Person</button
			>
			<button
				type="button"
				aria-pressed={kind === 'source'}
				class={tabClass(kind === 'source')}
				onclick={() => choose('source')}>Source</button
			>
		</div>
	{/if}
	{#if kind === 'source'}
		<SourcePicker
			{treeId}
			{idPrefix}
			bind:sourceId
			bind:sourceName
			onerror={(message) => (sourceError = message)}
			shouldFocus
		/>
		{#if sourceError}
			<p role="alert" class="text-xs font-medium text-orange-700">{sourceError}</p>
		{/if}
	{:else}
		<PersonPicker {treeId} label="Person" {picked} onpick={(person) => (picked = person)} />
	{/if}
</div>
