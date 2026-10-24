<script lang="ts">
	import PersonPicker from '#lib/components/PersonPicker.svelte';
	import { fetchUnions } from '#lib/api/evidence.js';
	import SourcePicker from '#lib/components/evidence/SourcePicker.svelte';

	interface Props {
		/** The tree whose people, partnerships and sources are offered. */
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

	let kind = $state<'person' | 'union' | 'source'>('person');
	let unions = $state<Array<{ id: string; name: string }>>([]);
	let hasMoreUnions = $state(false);
	let unionError = $state<string | null>(null);
	let sourceId = $state<string | null>(null);
	let sourceName = $state('');
	let sourceError = $state<string | null>(null);

	// The source picker reports through bindings, so the choice is copied out here; the person
	// picker reports through a callback and needs no effect.
	$effect(() => {
		if (kind === 'source') picked = sourceId ? { id: sourceId, name: sourceName } : null;
	});

	// No partnership search exists, so the list is paged and chosen from rather than typed into.
	async function loadUnions() {
		unionError = null;
		try {
			const page = await fetchUnions(
				treeId,
				new URLSearchParams({ offset: String(unions.length), limit: '100' })
			);
			unions = [
				...unions,
				...page.items.map((u) => ({
					id: u.id,
					name: u.partners.map((p) => p.displayName).join(' & ') || 'Partnership'
				}))
			];
			hasMoreUnions = page.hasMore;
		} catch {
			unionError = 'Could not load the partnerships';
		}
	}

	function choose(next: 'person' | 'union' | 'source') {
		if (next === kind) return;
		kind = next;
		if (next === 'union' && unions.length === 0) void loadUnions();
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
	<div role="group" aria-label="Kind of record" class="flex gap-1">
		<button
			type="button"
			aria-pressed={kind === 'person'}
			class={tabClass(kind === 'person')}
			onclick={() => choose('person')}>Person</button
		>
		<button
			type="button"
			aria-pressed={kind === 'union'}
			class={tabClass(kind === 'union')}
			onclick={() => choose('union')}>Partnership</button
		>
		{#if canPickSource}
			<button
				type="button"
				aria-pressed={kind === 'source'}
				class={tabClass(kind === 'source')}
				onclick={() => choose('source')}>Source</button
			>
		{/if}
	</div>
	{#if kind === 'union'}
		<label for="{idPrefix}-union" class="block text-xs font-semibold text-stone-700"
			>Partnership</label
		>
		<select
			id="{idPrefix}-union"
			class="mt-1 w-64 rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
			value={picked?.id ?? ''}
			onchange={(e) => {
				const found = unions.find((u) => u.id === e.currentTarget.value);
				picked = found ? { id: found.id, name: found.name } : null;
			}}
		>
			<option value="">Choose a partnership</option>
			{#each unions as union (union.id)}
				<option value={union.id}>{union.name}</option>
			{/each}
		</select>
		{#if hasMoreUnions}
			<button
				type="button"
				class="block text-xs font-medium text-emerald-800 underline"
				onclick={loadUnions}>Show more</button
			>
		{/if}
		{#if unionError}
			<p role="alert" class="text-xs font-medium text-orange-700">{unionError}</p>
		{/if}
	{:else if kind === 'source'}
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
