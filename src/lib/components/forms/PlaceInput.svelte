<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import { searchGeoApi } from '#lib/api/geo.js';
	import { suggestPlacesApi } from '#lib/api/lists.js';
	import { isGeocodable, type GeoCandidate } from '#lib/shared/geo.js';

	interface Props extends Omit<HTMLInputAttributes, 'value' | 'class' | 'list'> {
		/** The tree whose places are suggested. */
		treeId: string;
		/** The place as text. What is saved is whatever this holds; a suggestion only fills it in. */
		value: string;
		/** Id for the input, so the caller's `<label for>` points at it. */
		id: string;
		/** Classes for the input, so the field matches the form it sits in. */
		inputClass?: string;
		/** The input element, for a caller that needs to focus or select it. */
		element?: HTMLInputElement | null;
		/**
		 * Also suggest places from OpenStreetMap, under the tree's own, and offer "Find on map". Only
		 * for a field that records a place on a fact: each search sends the typed text to a third party
		 * through Epoch's Worker (ADR-078), which a search filter should not do.
		 */
		shouldSuggestOsm?: boolean;
		/**
		 * Called with the OpenStreetMap place the user picks, and with null once they edit the text
		 * away from it (or pick a place from the tree), so the caller only holds a pick that still
		 * matches the field.
		 */
		onosmpick?: (candidate: GeoCandidate | null) => void;
	}

	const uid = $props.id();
	let {
		treeId,
		value = $bindable(),
		id,
		inputClass = '',
		element = $bindable(null),
		shouldSuggestOsm = false,
		onosmpick,
		...rest
	}: Props = $props();

	const listId = `${uid}-places`;
	const MIN_TYPED_CHARACTERS = 2;
	const SUGGEST_DELAY_MS = 250;
	const OSM_DELAY_MS = 300;

	// Places already on the tree's facts, offered as the user types so one place keeps one spelling.
	let options = $state<string[]>([]);
	// A slower earlier answer must not replace a later one.
	let latestRequest = 0;

	$effect(() => {
		const typed = (value ?? '').trim();
		const request = ++latestRequest;
		if (typed.length < MIN_TYPED_CHARACTERS) {
			options = [];
			return;
		}
		const timer = setTimeout(async () => {
			let found: string[] = [];
			try {
				found = await suggestPlacesApi(treeId, typed);
			} catch {
				// Suggestions are a convenience; a failed lookup just shows none.
			}
			if (request === latestRequest) options = found;
		}, SUGGEST_DELAY_MS);
		return () => clearTimeout(timer);
	});

	let osmResults = $state<GeoCandidate[]>([]);
	let isOpen = $state(false);
	let highlighted = $state(-1);
	// Set once "Find on map" has answered, so an empty answer can be said aloud; typing alone stays silent.
	let didFind = $state(false);
	let searchController: AbortController | null = null;
	// The text an OSM pick filled in. Not state: the effect below must not rerun when it is set.
	let pickedText: string | null = null;

	async function searchOsm(text: string, isExplicit: boolean) {
		searchController?.abort();
		const controller = (searchController = new AbortController());
		let found: GeoCandidate[] = [];
		try {
			found = await searchGeoApi(treeId, text, controller.signal);
		} catch {
			// Off, down or aborted: the group just stays hidden.
		}
		if (controller.signal.aborted) return;
		osmResults = found;
		highlighted = -1;
		if (isExplicit) {
			didFind = true;
			isOpen = true;
		}
	}

	$effect(() => {
		if (!shouldSuggestOsm) return;
		const typed = (value ?? '').trim();
		if (!isGeocodable(typed) || typed === pickedText) {
			osmResults = [];
			return;
		}
		const timer = setTimeout(() => void searchOsm(typed, false), OSM_DELAY_MS);
		return () => {
			clearTimeout(timer);
			// The user typed on, so the answer to this text is no longer wanted.
			searchController?.abort();
		};
	});

	type Entry = { text: string; candidate: GeoCandidate | null };
	const entries = $derived<Entry[]>([
		...options.map((text) => ({ text, candidate: null })),
		...osmResults.map((candidate) => ({ text: candidate.displayName, candidate }))
	]);
	const isListVisible = $derived(
		shouldSuggestOsm && isOpen && (entries.length > 0 || (didFind && osmResults.length === 0))
	);

	function forgetPick() {
		if (pickedText === null) return;
		pickedText = null;
		onosmpick?.(null);
	}

	function choose(entry: Entry) {
		value = entry.text;
		isOpen = false;
		highlighted = -1;
		if (entry.candidate) {
			pickedText = entry.text;
			osmResults = [];
			onosmpick?.(entry.candidate);
		} else {
			forgetPick();
		}
	}

	function onInput(event: Event) {
		didFind = false;
		isOpen = true;
		highlighted = -1;
		if ((event.currentTarget as HTMLInputElement).value.trim() !== pickedText) forgetPick();
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && isListVisible) {
			// The list is the innermost thing open; a dialog around the field must stay.
			event.stopPropagation();
			isOpen = false;
		} else if (event.key === 'ArrowDown' && entries.length > 0) {
			event.preventDefault();
			isOpen = true;
			highlighted = (highlighted + 1) % entries.length;
		} else if (event.key === 'ArrowUp' && entries.length > 0) {
			event.preventDefault();
			isOpen = true;
			highlighted = (highlighted - 1 + entries.length) % entries.length;
		} else if (event.key === 'Enter' && isListVisible && entries[highlighted]) {
			// Only with a highlighted entry: otherwise Enter still submits the form.
			event.preventDefault();
			choose(entries[highlighted]!);
		}
	}

	function findOnMap() {
		const typed = (value ?? '').trim();
		if (!isGeocodable(typed)) {
			osmResults = [];
			didFind = true;
			isOpen = true;
			return;
		}
		void searchOsm(typed, true);
	}

	const optionClass = 'cursor-pointer px-3 py-1.5 text-sm aria-selected:bg-stone-100';
</script>

{#if shouldSuggestOsm}
	<div class="relative">
		<div class="flex items-center gap-2">
			<input
				type="text"
				autocomplete="off"
				{...rest}
				{id}
				bind:this={element}
				bind:value
				class={inputClass}
				role="combobox"
				aria-autocomplete="list"
				aria-expanded={isListVisible}
				aria-controls={listId}
				aria-activedescendant={isListVisible && highlighted >= 0
					? `${uid}-option-${highlighted}`
					: undefined}
				oninput={onInput}
				onkeydown={onKeydown}
				onblur={() => (isOpen = false)}
			/>
			<button
				type="button"
				onclick={findOnMap}
				class="shrink-0 cursor-pointer rounded-md border border-stone-300 bg-white px-2 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50"
				>Find on map</button
			>
		</div>
		<!-- Always in the DOM so aria-controls has a target; the groups render only when open. -->
		<div
			id={listId}
			role="listbox"
			aria-label="Place suggestions"
			hidden={!isListVisible}
			class="absolute inset-x-0 z-20 mt-1 max-h-72 overflow-auto rounded-lg border border-stone-300 bg-white py-1 shadow-lg"
		>
			{#if isListVisible}
				{#if options.length > 0}
					<div role="group" aria-labelledby="{uid}-tree-heading">
						<div
							id="{uid}-tree-heading"
							role="presentation"
							class="px-3 py-1 text-xs font-semibold text-stone-500"
						>
							In this tree
						</div>
						{#each options as option, i (option)}
							<!-- svelte-ignore a11y_click_events_have_key_events, a11y_interactive_supports_focus -->
							<div
								id="{uid}-option-{i}"
								role="option"
								aria-selected={highlighted === i}
								onmousedown={(event) => event.preventDefault()}
								onclick={() => choose(entries[i]!)}
								onmouseenter={() => (highlighted = i)}
								class={optionClass}
							>
								{option}
							</div>
						{/each}
					</div>
				{/if}
				{#if osmResults.length > 0}
					<div role="group" aria-labelledby="{uid}-osm-heading">
						<div
							id="{uid}-osm-heading"
							role="presentation"
							class="px-3 py-1 text-xs font-semibold text-stone-500"
						>
							From OpenStreetMap
						</div>
						{#each osmResults as candidate, j (`${candidate.osmType}${candidate.osmId}${candidate.displayName}`)}
							{@const i = options.length + j}
							<!-- svelte-ignore a11y_click_events_have_key_events, a11y_interactive_supports_focus -->
							<div
								id="{uid}-option-{i}"
								role="option"
								aria-selected={highlighted === i}
								onmousedown={(event) => event.preventDefault()}
								onclick={() => choose(entries[i]!)}
								onmouseenter={() => (highlighted = i)}
								class={optionClass}
							>
								{candidate.displayName}{#if candidate.kind}{' '}<span class="text-xs text-stone-500"
										>({candidate.kind})</span
									>{/if}
							</div>
						{/each}
						<div role="presentation" class="px-3 py-1 text-xs text-stone-500">
							© OpenStreetMap contributors
						</div>
					</div>
				{:else if didFind}
					<div role="presentation" class="px-3 py-1.5 text-xs text-stone-500">
						No matches on OpenStreetMap.
					</div>
				{/if}
			{/if}
		</div>
	</div>
{:else}
	<input
		type="text"
		autocomplete="off"
		{...rest}
		{id}
		bind:this={element}
		bind:value
		list={listId}
		class={inputClass}
	/>
	<datalist id={listId}
		>{#each options as option (option)}<option value={option}></option>{/each}</datalist
	>
{/if}
