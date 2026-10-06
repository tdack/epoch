<script lang="ts">
	import { ArrowRight, Search } from 'lucide-svelte';
	import type { PeopleSearchResult } from '#lib/types/genealogy.js';

	interface Props {
		/** The tree being searched; profile and fact-search links are built from it. */
		treeId: string;
		/** Search the tree's people by name. */
		searchPeople: (query: string) => Promise<PeopleSearchResult[]>;
		/** Offered before anything is typed: the people the user favourited and opened lately. */
		suggestions?: {
			favorites: Array<{ id: string; displayName: string }>;
			recents: Array<{ id: string; displayName: string }>;
		};
		/**
		 * Given on the chart page only: Enter then refocuses the chart on the person instead of opening
		 * their profile. Shift+Enter always opens the profile.
		 */
		onpickFocus?: (personId: string) => void;
		/** Go to an address in the app. */
		onnavigate: (href: string) => void;
	}

	let {
		treeId,
		searchPeople,
		suggestions = { favorites: [], recents: [] },
		onpickFocus,
		onnavigate
	}: Props = $props();

	type Option =
		| { kind: 'person'; key: string; id: string; label: string; alias?: string; group?: string }
		| { kind: 'search'; key: string; label: string };

	const SEARCH_DEBOUNCE_MS = 200;
	const MAX_RESULTS = 8;
	const uid = $props.id();
	const listId = `${uid}-results`;

	let input: HTMLInputElement | undefined = $state();
	let query = $state('');
	let results = $state<PeopleSearchResult[]>([]);
	let isOpen = $state(false);
	let highlighted = $state(0);
	let isSearching = $state(false);
	let hasSearched = $state(false);
	let hasSearchFailed = $state(false);
	let isFocused = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let latestRequest = 0;

	/** Move keyboard focus into the box, selecting what is there so typing replaces it. */
	export function focus() {
		input?.focus();
		input?.select();
	}

	const base = $derived(`/trees/${encodeURIComponent(treeId)}`);
	const profileHref = (id: string) => `${base}/people/${encodeURIComponent(id)}`;
	const searchHref = (q: string) => `${base}/search?q=${encodeURIComponent(q)}`;

	function label(person: PeopleSearchResult): string {
		return [person.givenName, person.surname].filter(Boolean).join(' ') || person.id;
	}

	// A favourite is listed once, under Favourite, and not again among the recents.
	const suggestionOptions = $derived<Option[]>([
		...suggestions.favorites.map((p) => ({
			kind: 'person' as const,
			key: `person:${p.id}`,
			id: p.id,
			label: p.displayName,
			group: 'Favourite'
		})),
		...suggestions.recents
			.filter((r) => !suggestions.favorites.some((f) => f.id === r.id))
			.map((p) => ({
				kind: 'person' as const,
				key: `person:${p.id}`,
				id: p.id,
				label: p.displayName,
				group: 'Recent'
			}))
	]);
	const trimmed = $derived(query.trim());
	const options = $derived<Option[]>(
		trimmed
			? [
					...results.map((r) => ({
						kind: 'person' as const,
						key: `person:${r.id}`,
						id: r.id,
						label: label(r),
						alias: r.matchedName
					})),
					{
						kind: 'search' as const,
						key: 'search',
						label: `Search facts, dates and places for “${trimmed}”`
					}
				]
			: suggestionOptions
	);

	function onFocus() {
		isFocused = true;
		if (!trimmed && suggestionOptions.length > 0) {
			highlighted = 0;
			isOpen = true;
		}
	}

	function onInput() {
		clearTimeout(timer);
		hasSearchFailed = false;
		hasSearched = false;
		highlighted = 0;
		if (!trimmed) {
			results = [];
			isOpen = suggestionOptions.length > 0;
			return;
		}
		isOpen = true;
		timer = setTimeout(async () => {
			const request = ++latestRequest;
			isSearching = true;
			try {
				const found = await searchPeople(trimmed);
				// A slower earlier request must not overwrite the newer one.
				if (request !== latestRequest) return;
				results = found.slice(0, MAX_RESULTS);
				hasSearched = true;
				highlighted = 0;
				isOpen = true;
			} catch {
				if (request === latestRequest) hasSearchFailed = true;
			} finally {
				if (request === latestRequest) isSearching = false;
			}
		}, SEARCH_DEBOUNCE_MS);
	}

	function choose(option: Option, shouldOpenProfile: boolean) {
		const typed = trimmed;
		query = '';
		results = [];
		isOpen = false;
		if (option.kind === 'search') onnavigate(searchHref(typed));
		else if (onpickFocus && !shouldOpenProfile) onpickFocus(option.id);
		else onnavigate(profileHref(option.id));
		input?.blur();
	}

	function onSearchKeydown(event: KeyboardEvent) {
		if (event.key === 'ArrowDown' && options.length > 0) {
			event.preventDefault();
			isOpen = true;
			highlighted = (highlighted + 1) % options.length;
		} else if (event.key === 'ArrowUp' && options.length > 0) {
			event.preventDefault();
			highlighted = (highlighted - 1 + options.length) % options.length;
		} else if (event.key === 'Enter' && isOpen && options[highlighted]) {
			event.preventDefault();
			choose(options[highlighted], event.shiftKey);
		} else if (event.key === 'Escape' && isOpen) {
			event.stopPropagation();
			isOpen = false;
		}
	}

	function isTypingTarget(target: EventTarget | null): boolean {
		return (
			target instanceof HTMLElement &&
			(target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
		);
	}

	function onWindowKeydown(event: KeyboardEvent) {
		const isModified = event.metaKey || event.ctrlKey;
		if (isModified && !event.altKey && event.key.toLowerCase() === 'k') {
			event.preventDefault();
			focus();
		} else if (event.key === '/' && !isModified && !event.altKey && !isTypingTarget(event.target)) {
			event.preventDefault();
			focus();
		}
	}
</script>

<svelte:window onkeydown={onWindowKeydown} />

<div class="relative w-full">
	<label for="{uid}-input" class="sr-only">Find a person</label>
	<Search
		class="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-stone-500"
		aria-hidden="true"
	/>
	<input
		bind:this={input}
		id="{uid}-input"
		type="search"
		role="combobox"
		autocomplete="off"
		placeholder="Find a person…"
		aria-expanded={isOpen}
		aria-controls={listId}
		aria-autocomplete="list"
		aria-keyshortcuts="Control+K Meta+K /"
		aria-activedescendant={isOpen && options[highlighted]
			? `${uid}-option-${highlighted}`
			: undefined}
		bind:value={query}
		oninput={onInput}
		onkeydown={onSearchKeydown}
		onfocus={onFocus}
		onblur={() => {
			isFocused = false;
			setTimeout(() => (isOpen = false), 120);
		}}
		class="w-full rounded-lg border focus-input border-stone-300 bg-white py-1.5 pr-9 pl-8 text-xs text-stone-900 shadow-xs placeholder:text-stone-500 coarse:min-h-11"
	/>
	{#if !isFocused && !query}
		<kbd
			class="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 rounded border border-stone-300 bg-stone-50 px-1.5 text-[10px] font-medium text-stone-500 sm:block"
			aria-hidden="true">/</kbd
		>
	{/if}
	{#if isOpen}
		<ul
			id={listId}
			role="listbox"
			aria-label="People"
			class="absolute top-full right-0 left-0 z-40 mt-1.5 max-h-72 overflow-y-auto rounded-xl border border-stone-300 bg-white py-1 text-xs shadow-lg shadow-stone-900/10"
		>
			{#each options as option, i (option.key)}
				<li
					id="{uid}-option-{i}"
					role="option"
					aria-selected={i === highlighted}
					class="menu-item cursor-pointer px-3 py-2 {option.kind === 'search'
						? 'flex items-center gap-1.5 border-t border-stone-200 font-medium text-emerald-900'
						: ''}"
					onmousedown={(event) => {
						event.preventDefault();
						choose(option, event.shiftKey);
					}}
				>
					{option.label}
					{#if option.kind === 'search'}
						<ArrowRight class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
					{:else}
						{#if option.group}
							<span class="block text-xs text-stone-500">{option.group}</span>
						{/if}
						{#if option.alias}
							<span class="block text-xs text-stone-500">also known as {option.alias}</span>
						{/if}
					{/if}
				</li>
			{/each}
			{#if hasSearchFailed}
				<li class="px-3 py-2 text-red-700" role="presentation">Search failed</li>
			{:else if trimmed && hasSearched && results.length === 0}
				<li class="px-3 py-2 text-stone-500" role="presentation">No matching people</li>
			{/if}
		</ul>
	{/if}
	{#if hasSearchFailed}
		<span class="sr-only" role="alert">Search failed</span>
	{:else if isSearching}
		<span class="sr-only" aria-live="polite">Searching</span>
	{/if}
</div>
