<script lang="ts">
	import { searchPeopleApi } from '#lib/api/lists.js';
	import { namesWithBirth } from '#lib/shared/person-name.js';
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
		/** Shown in place of a name while nobody is picked. */
		emptyName?: string;
		/**
		 * For a row of filters: the picked name sits in the field itself rather than on a line above
		 * it, so the field lines up with its neighbours.
		 */
		isInline?: boolean;
	}

	let {
		treeId,
		label,
		picked,
		onpick,
		emptyName = 'Nobody chosen',
		isInline = false
	}: Props = $props();

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
				const names = namesWithBirth(found, nameOf);
				results = found.map((p, i) => ({ id: p.id, name: names[i], alias: p.matchedName }));
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
	{#if !isInline}
		<p class="mt-0.5 text-sm font-medium text-stone-900" data-testid="picked-{label.toLowerCase()}">
			{picked ? picked.name : emptyName}
		</p>
	{/if}
	<input
		id="{uid}-input"
		type="text"
		role="combobox"
		autocomplete="off"
		placeholder={isInline ? (picked?.name ?? emptyName) : 'Search by name'}
		bind:value={query}
		oninput={onInput}
		onkeydown={onKeydown}
		aria-expanded={isOpen}
		aria-controls="{uid}-results"
		aria-autocomplete="list"
		aria-activedescendant={isOpen && results[highlighted]
			? `${uid}-option-${highlighted}`
			: undefined}
		class={isInline
			? `mt-1 h-9 w-full rounded-lg border border-stone-300 bg-white px-2 text-sm font-normal sm:w-56 coarse:h-11 ${picked ? 'placeholder:text-stone-900' : 'placeholder:text-stone-500'}`
			: 'mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm sm:w-64'}
	/>
	{#if isOpen}
		<!-- Floating only in a filter row: a dialog's own scroll would clip a floating list, so there
		     the results push the content down instead. -->
		<ul
			id="{uid}-results"
			role="listbox"
			aria-label="{label} results"
			class="mt-1 max-h-72 overflow-auto rounded-lg border border-stone-300 bg-white py-1 {isInline
				? 'absolute inset-x-0 z-20 shadow-lg sm:right-auto sm:w-max sm:max-w-sm sm:min-w-64'
				: 'sm:w-64'}"
		>
			{#each results as option, i (option.id)}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<li
					id="{uid}-option-{i}"
					role="option"
					aria-selected={i === highlighted}
					onclick={() => choose(option)}
					onmouseenter={() => (highlighted = i)}
					class="flex menu-item cursor-pointer flex-col justify-center px-3 py-1.5 text-sm"
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
					class="flex min-h-9 items-center px-3 py-1.5 text-sm text-stone-500 coarse:min-h-11"
				>
					No matching people
				</li>
			{/each}
		</ul>
	{/if}
	{#if hasFailed}<p class="mt-1 text-xs text-red-700" role="alert">Search failed</p>{/if}
</div>
