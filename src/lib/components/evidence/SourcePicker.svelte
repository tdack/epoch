<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { messageOf } from '#lib/components/feedback/error-message.js';
	import { createSourceApi, fetchSources } from '#lib/api/evidence.js';
	import type { SourceListItem } from '#lib/shared/evidence.js';

	interface Props {
		treeId: string;
		/** Prefix for element ids, so two pickers on a page do not share them. */
		idPrefix: string;
		/** The chosen source's id, or null while none is chosen. Two-way. */
		sourceId: string | null;
		/** The chosen source's name, for the line that replaces the search. Two-way. */
		sourceName: string;
		/** Reports a problem the picker cannot show itself (an empty title, a failed create). */
		onerror: (message: string | null) => void;
		/** Focuses the search box when it appears; off for a picker inside a closed disclosure. */
		shouldFocus?: boolean;
	}

	let {
		treeId,
		idPrefix,
		sourceId = $bindable(),
		sourceName = $bindable(),
		onerror,
		shouldFocus = false
	}: Props = $props();

	const SEARCH_DELAY_MS = 250;
	const RESULTS_SHOWN = 8;

	let isChoosing = $state(untrack(() => sourceId === null));
	let query = $state('');
	let results = $state<SourceListItem[]>([]);
	let activeIndex = $state(-1);
	let isListOpen = $state(false);
	let isNewSource = $state(false);
	let newTitle = $state('');
	let newAuthor = $state('');
	let searchInput = $state<HTMLInputElement | null>(null);

	const field =
		'w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 coarse:text-base';
	const listId = $derived(`${idPrefix}-source-results`);
	const optionId = (index: number) => `${idPrefix}-source-option-${index}`;

	// The parent may clear or fill the choice (a dialog reopening); follow it.
	$effect(() => {
		isChoosing = sourceId === null;
	});

	// Sources matching what is typed, a few at a time: the tree may hold thousands.
	$effect(() => {
		const typed = query.trim();
		if (!isChoosing || isNewSource) return;
		const timer = setTimeout(async () => {
			try {
				const found = await fetchSources(
					treeId,
					new URLSearchParams({ q: typed, limit: String(RESULTS_SHOWN) })
				);
				results = found.items;
				activeIndex = -1;
			} catch {
				results = [];
			}
		}, SEARCH_DELAY_MS);
		return () => clearTimeout(timer);
	});

	$effect(() => {
		if (isChoosing && shouldFocus) void tick().then(() => searchInput?.focus());
	});

	const labelOf = (source: SourceListItem) =>
		source.title || source.abbreviation || source.author || 'Untitled source';

	function choose(source: SourceListItem) {
		sourceId = source.id;
		sourceName = labelOf(source);
		isChoosing = false;
		isNewSource = false;
		isListOpen = false;
		query = '';
		onerror(null);
	}

	async function makeSource() {
		const title = newTitle.trim();
		if (!title) {
			onerror('Give the new source a title.');
			return;
		}
		onerror(null);
		try {
			const created = await createSourceApi(treeId, { title, author: newAuthor.trim() || null });
			sourceId = created.sourceId;
			sourceName = title;
			isChoosing = false;
			isNewSource = false;
			newTitle = '';
			newAuthor = '';
		} catch (cause: unknown) {
			onerror(messageOf(cause, 'Could not add the source'));
		}
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			if (results.length === 0) return;
			event.preventDefault();
			isListOpen = true;
			const step = event.key === 'ArrowDown' ? 1 : -1;
			activeIndex = (activeIndex + step + results.length) % results.length;
		} else if (event.key === 'Enter' && isListOpen && activeIndex >= 0) {
			// The form must not submit while a result is being picked.
			event.preventDefault();
			choose(results[activeIndex]!);
		} else if (event.key === 'Escape' && isListOpen) {
			// Close the list, not the surrounding dialog.
			event.stopPropagation();
			isListOpen = false;
			activeIndex = -1;
		}
	}
</script>

<div class="space-y-2">
	{#if !isChoosing && sourceId}
		<p class="flex items-center justify-between gap-2 text-sm">
			<span class="font-semibold text-stone-900" data-testid="chosen-source">{sourceName}</span>
			<button
				type="button"
				class="row-link text-xs font-semibold coarse:min-h-11"
				onclick={() => (isChoosing = true)}>Change source</button
			>
		</p>
	{:else if isNewSource}
		<div class="space-y-2 rounded-lg border border-stone-300 bg-white p-3">
			<div>
				<label for="{idPrefix}-new-title" class="field-label">Title of the new source</label>
				<input id="{idPrefix}-new-title" type="text" bind:value={newTitle} class={field} />
			</div>
			<div>
				<label for="{idPrefix}-new-author" class="field-label"
					>Author <span class="font-normal text-stone-500">(optional)</span></label
				>
				<input id="{idPrefix}-new-author" type="text" bind:value={newAuthor} class={field} />
			</div>
			<div class="flex gap-3 text-sm font-semibold">
				<button type="button" class="action-btn" onclick={() => void makeSource()}
					>Add this source</button
				>
				<button type="button" class="row-link coarse:min-h-11" onclick={() => (isNewSource = false)}
					>Back to search</button
				>
			</div>
		</div>
	{:else}
		<label for="{idPrefix}-source-search" class="sr-only">Search sources by title or author</label>
		<input
			id="{idPrefix}-source-search"
			type="search"
			role="combobox"
			aria-expanded={isListOpen && results.length > 0}
			aria-controls={listId}
			aria-autocomplete="list"
			aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
			bind:this={searchInput}
			bind:value={query}
			oninput={() => (isListOpen = true)}
			onfocus={() => (isListOpen = true)}
			{onkeydown}
			autocomplete="off"
			class={field}
			placeholder="Search by title or author"
		/>
		{#if results.length > 0}
			<ul
				id={listId}
				role="listbox"
				class="max-h-40 divide-y divide-stone-200 overflow-y-auto rounded-lg border border-stone-300 bg-white text-sm"
				aria-label="Matching sources"
				data-testid="source-results"
			>
				{#each results as result, index (result.id)}
					<!-- The keyboard stays in the input via aria-activedescendant; options take the pointer. -->
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<li
						id={optionId(index)}
						role="option"
						aria-selected={index === activeIndex}
						class="menu-item cursor-pointer px-3 py-1.5 coarse:flex coarse:items-center"
						onclick={() => choose(result)}
					>
						<span class="font-semibold text-stone-900">{labelOf(result)}</span>
						{#if result.author}<span class="text-xs text-stone-600"> · {result.author}</span>{/if}
					</li>
				{/each}
			</ul>
		{:else if query.trim()}
			<p class="text-xs text-stone-600">No source matches.</p>
		{/if}
		<button
			type="button"
			class="row-link text-xs font-semibold coarse:min-h-11"
			onclick={() => (isNewSource = true)}>Make a new source…</button
		>
	{/if}
</div>
