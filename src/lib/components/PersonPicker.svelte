<script lang="ts">
	import { searchPeopleApi } from '#lib/api/tree-api.js';
	import type { PeopleSearchResult } from '#lib/types/genealogy.js';

	interface Props {
		/** The tree to search. */
		treeId: string;
		/** Names the field, for sighted and screen reader users alike. */
		label: string;
		/** The person chosen, if any. */
		picked: { id: string; name: string } | null;
		/** Called with the person the user picks from the results. */
		onpick: (person: { id: string; name: string }) => void;
	}

	let { treeId, label, picked, onpick }: Props = $props();

	const SEARCH_DEBOUNCE_MS = 200;
	const uid = $props.id();

	let query = $state('');
	let results = $state<Array<{ id: string; name: string; alias?: string }>>([]);
	let isOpen = $state(false);
	let highlighted = $state(0);
	let hasFailed = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let latest = 0;

	const nameOf = (p: PeopleSearchResult) =>
		[p.givenName, p.surname].filter(Boolean).join(' ') || p.id;

	function onInput() {
		clearTimeout(timer);
		hasFailed = false;
		if (!query.trim()) {
			results = [];
			isOpen = false;
			return;
		}
		const request = ++latest;
		timer = setTimeout(async () => {
			try {
				const found = await searchPeopleApi(treeId, query.trim());
				// A slower earlier answer must not replace a later one.
				if (request !== latest) return;
				results = found.map((p) => ({ id: p.id, name: nameOf(p), alias: p.matchedName }));
				highlighted = 0;
				isOpen = true;
			} catch {
				if (request === latest) hasFailed = true;
			}
		}, SEARCH_DEBOUNCE_MS);
	}

	function choose(option: { id: string; name: string }) {
		onpick({ id: option.id, name: option.name });
		query = '';
		results = [];
		isOpen = false;
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			isOpen = false;
		} else if (event.key === 'ArrowDown' && results.length > 0) {
			event.preventDefault();
			isOpen = true;
			highlighted = (highlighted + 1) % results.length;
		} else if (event.key === 'ArrowUp' && results.length > 0) {
			event.preventDefault();
			highlighted = (highlighted - 1 + results.length) % results.length;
		} else if (event.key === 'Enter' && isOpen && results[highlighted]) {
			event.preventDefault();
			choose(results[highlighted]!);
		}
	}
</script>

<div class="relative">
	<label for="{uid}-input" class="block text-xs font-semibold text-stone-700">{label}</label>
	<p class="mt-0.5 text-sm font-medium text-stone-900" data-testid="picked-{label.toLowerCase()}">
		{picked ? picked.name : 'Nobody chosen'}
	</p>
	<input
		id="{uid}-input"
		type="text"
		role="combobox"
		autocomplete="off"
		placeholder="Search by name"
		bind:value={query}
		oninput={onInput}
		onkeydown={onKeydown}
		aria-expanded={isOpen}
		aria-controls="{uid}-results"
		aria-autocomplete="list"
		aria-activedescendant={isOpen && results[highlighted]
			? `${uid}-option-${highlighted}`
			: undefined}
		class="mt-1 w-64 rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
	/>
	{#if isOpen}
		<ul
			id="{uid}-results"
			role="listbox"
			aria-label="{label} results"
			class="absolute z-10 mt-1 max-h-60 w-64 overflow-auto rounded-lg border border-stone-200 bg-white shadow"
		>
			{#each results as option, i (option.id)}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<li
					id="{uid}-option-{i}"
					role="option"
					aria-selected={i === highlighted}
					onclick={() => choose(option)}
					onmouseenter={() => (highlighted = i)}
					class="cursor-pointer px-3 py-1.5 text-sm {i === highlighted ? 'bg-emerald-50' : ''}"
				>
					{option.name}{#if option.alias}<span class="block text-xs text-stone-500"
							>also {option.alias}</span
						>{/if}
				</li>
			{:else}
				<li
					role="option"
					aria-selected="false"
					aria-disabled="true"
					class="px-3 py-1.5 text-sm text-stone-500"
				>
					No matching people
				</li>
			{/each}
		</ul>
	{/if}
	{#if hasFailed}<p class="mt-1 text-xs text-red-700" role="alert">Search failed</p>{/if}
</div>
