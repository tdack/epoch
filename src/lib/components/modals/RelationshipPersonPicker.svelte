<script lang="ts">
	import { Search } from '@lucide/svelte';
	import { personName } from '#lib/shared/person-name.js';
	import { SEX_LABELS, SEX_VALUES } from '#lib/shared/sex.js';
	import type { RelationshipDraft } from './relationship-draft.svelte.js';

	interface Props {
		/** The dialog's shared draft. */
		rel: RelationshipDraft;
	}

	let { rel }: Props = $props();
</script>

<div class="flex items-center gap-2">
	<button
		type="button"
		onclick={() => (rel.isAddingNewPerson = false)}
		aria-pressed={!rel.isAddingNewPerson}
		class="cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-medium {!rel.isAddingNewPerson
			? 'border-emerald-400 bg-emerald-100 text-emerald-900'
			: 'border-stone-300 bg-white text-stone-600'}"
	>
		Existing person
	</button>
	<button
		type="button"
		onclick={() => (rel.isAddingNewPerson = true)}
		aria-pressed={rel.isAddingNewPerson}
		class="cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-medium {rel.isAddingNewPerson
			? 'border-emerald-400 bg-emerald-100 text-emerald-900'
			: 'border-stone-300 bg-white text-stone-600'}"
	>
		New person
	</button>
</div>

{#if rel.isAddingNewPerson}
	<div class="space-y-2">
		<label class="block text-xs font-semibold text-stone-700" for="new-given">Given name</label>
		<input id="new-given" type="text" bind:value={rel.newGivenName} class="field-input" />
		<label class="block text-xs font-semibold text-stone-700" for="new-surname">Surname</label>
		<input id="new-surname" type="text" bind:value={rel.newSurname} class="field-input" />
		<!-- Offered, never filled in: a mother's stored surname may be her birth name. -->
		{#if rel.suggestedSurname}<button
				type="button"
				class="text-link text-xs"
				data-testid="suggest-surname"
				onclick={() => (rel.newSurname = rel.suggestedSurname ?? '')}
				>Use {rel.suggestedSurname}</button
			>{/if}
		<label class="block text-xs font-semibold text-stone-700" for="new-sex">Sex</label>
		<select id="new-sex" bind:value={rel.newSex} class="field-input">
			{#each SEX_VALUES as value (value)}
				<option {value}>{SEX_LABELS[value]}</option>
			{/each}
		</select>
	</div>
{:else}
	<div class="space-y-2">
		<label class="block text-xs font-semibold text-stone-700" for="rel-search"
			>Search people by name</label
		>
		<div class="flex gap-2">
			<input
				id="rel-search"
				type="text"
				bind:value={rel.searchQuery}
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						rel.runSearch();
					}
				}}
				class="flex-1 rounded-lg border border-stone-300 bg-white p-2 text-sm"
			/>
			<button
				type="button"
				onclick={() => rel.runSearch()}
				aria-label="Search"
				class="cursor-pointer rounded-lg border border-stone-300 bg-stone-100 p-2"
			>
				<Search class="h-4 w-4 text-stone-600" />
			</button>
		</div>
		{#if rel.selected}
			<p class="text-xs text-emerald-800">
				Selected: <span class="font-semibold">{personName(rel.selected)}</span>
			</p>
		{/if}
		{#if rel.isSearching}
			<p class="text-xs text-stone-500">Searching…</p>
		{:else if rel.results.length > 0}
			<ul class="max-h-40 space-y-1 overflow-y-auto" aria-label="Search results">
				{#each rel.results as r, i (r.id)}
					<li>
						<button
							type="button"
							onclick={() => (rel.selected = r)}
							aria-pressed={rel.selected?.id === r.id}
							class="w-full cursor-pointer rounded-lg border px-3 py-2 text-left text-sm {rel
								.selected?.id === r.id
								? 'border-emerald-400 bg-emerald-100'
								: 'border-stone-200 bg-white'}"
						>
							{rel.resultLabels[i]}
							{#if r.matchedName}
								<span class="block text-xs text-stone-500">also known as {r.matchedName}</span>
							{/if}
						</button>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="text-xs text-stone-500">Press Enter to search.</p>
		{/if}
	</div>
{/if}
