<script lang="ts">
	import { Minus, Plus, Search } from 'lucide-svelte';
	import type { ParentChildType } from '#lib/server/domain/genealogy-model.js';
	import type { PeopleSearchResult } from '#lib/types/genealogy.js';
	import { ALL_PARENT_CHILD_TYPES, MAX_DEPTH, type TreeViewState } from './tree-url.js';
	import { RELATIONSHIP_STYLES } from './tree-view.js';

	interface Props {
		/** The current view; the toolbar reports changes and does not keep its own copy. */
		view: TreeViewState;
		/** Search the tree's people by name. */
		searchPeople: (query: string) => Promise<PeopleSearchResult[]>;
		/** Merge these fields into the view. */
		onChange: (change: Partial<TreeViewState>) => void;
		/** Refocus the tree on a person picked from the search results. */
		onPickFocus: (personId: string) => void;
		/** Offered before anything is typed: the people the user favourited and opened lately. */
		suggestions?: {
			favorites: Array<{ id: string; displayName: string }>;
			recents: Array<{ id: string; displayName: string }>;
		};
	}

	let {
		view,
		searchPeople,
		onChange,
		onPickFocus,
		suggestions = { favorites: [], recents: [] }
	}: Props = $props();

	interface Option {
		id: string;
		label: string;
		/** Set when the person was found through a name they are not shown by. */
		alias?: string;
		/** Set on a suggestion, to say why it is offered. */
		group?: string;
	}

	const SEARCH_DEBOUNCE_MS = 200;

	let query = $state('');
	let results = $state<PeopleSearchResult[]>([]);
	let isOpen = $state(false);
	let highlighted = $state(0);
	let isSearching = $state(false);
	let hasSearchFailed = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let latestRequest = 0;

	function label(person: PeopleSearchResult): string {
		return [person.givenName, person.surname].filter(Boolean).join(' ') || person.id;
	}

	// A favourite is listed once, under Favourites, and not again among the recents.
	const suggestionOptions = $derived<Option[]>([
		...suggestions.favorites.map((p) => ({ id: p.id, label: p.displayName, group: 'Favourite' })),
		...suggestions.recents
			.filter((r) => !suggestions.favorites.some((f) => f.id === r.id))
			.map((p) => ({ id: p.id, label: p.displayName, group: 'Recent' }))
	]);
	const options = $derived<Option[]>(
		query.trim()
			? results.map((r) => ({ id: r.id, label: label(r), alias: r.matchedName }))
			: suggestionOptions
	);

	function onFocus() {
		if (!query.trim() && suggestionOptions.length > 0) {
			highlighted = 0;
			isOpen = true;
		}
	}

	function onInput() {
		clearTimeout(timer);
		hasSearchFailed = false;
		if (!query.trim()) {
			results = [];
			highlighted = 0;
			isOpen = suggestionOptions.length > 0;
			return;
		}
		timer = setTimeout(async () => {
			const request = ++latestRequest;
			isSearching = true;
			try {
				const found = await searchPeople(query.trim());
				// A slower earlier request must not overwrite the newer one.
				if (request !== latestRequest) return;
				results = found.slice(0, 8);
				highlighted = 0;
				isOpen = true;
			} catch {
				if (request === latestRequest) hasSearchFailed = true;
			} finally {
				if (request === latestRequest) isSearching = false;
			}
		}, SEARCH_DEBOUNCE_MS);
	}

	function pick(person: { id: string }) {
		query = '';
		results = [];
		isOpen = false;
		onPickFocus(person.id);
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
			pick(options[highlighted]);
		} else if (event.key === 'Escape' && isOpen) {
			event.stopPropagation();
			isOpen = false;
		}
	}

	function setDepth(field: 'ancestorDepth' | 'descendantDepth', value: number) {
		onChange({ [field]: Math.min(MAX_DEPTH, Math.max(0, value)) });
	}

	function toggleType(type: ParentChildType) {
		const isShown = view.types.includes(type);
		// Hiding the last type would draw no parentage at all, so one always stays on.
		if (isShown && view.types.length === 1) return;
		onChange({
			types: ALL_PARENT_CHILD_TYPES.filter((t) => (t === type ? !isShown : view.types.includes(t)))
		});
	}
</script>

{#snippet stepper(name: string, field: 'ancestorDepth' | 'descendantDepth')}
	<div class="group" role="group" aria-label="{name} generations">
		<span class="caption">{name}</span>
		<button
			type="button"
			class="step"
			aria-label="Fewer {name.toLowerCase()} generations"
			disabled={view[field] <= 0}
			onclick={() => setDepth(field, view[field] - 1)}
		>
			<Minus class="h-3.5 w-3.5" />
		</button>
		<output class="value" aria-live="polite">{view[field]}</output>
		<button
			type="button"
			class="step"
			aria-label="More {name.toLowerCase()} generations"
			disabled={view[field] >= MAX_DEPTH}
			onclick={() => setDepth(field, view[field] + 1)}
		>
			<Plus class="h-3.5 w-3.5" />
		</button>
	</div>
{/snippet}

<div class="toolbar" role="toolbar" aria-label="Tree view controls">
	<div class="search">
		<label for="tree-focus-search" class="sr-only">Focus on a person</label>
		<Search class="icon h-4 w-4" />
		<input
			id="tree-focus-search"
			type="search"
			role="combobox"
			autocomplete="off"
			placeholder="Focus on a person…"
			aria-expanded={isOpen}
			aria-controls="tree-focus-results"
			aria-autocomplete="list"
			aria-activedescendant={isOpen && options[highlighted]
				? `tree-focus-result-${highlighted}`
				: undefined}
			bind:value={query}
			oninput={onInput}
			onkeydown={onSearchKeydown}
			onfocus={onFocus}
			onblur={() => setTimeout(() => (isOpen = false), 120)}
		/>
		{#if isOpen}
			<ul id="tree-focus-results" class="results" role="listbox" aria-label="People">
				{#each options as option, i (option.id)}
					<li
						id="tree-focus-result-{i}"
						role="option"
						aria-selected={i === highlighted}
						class:active={i === highlighted}
						onmousedown={(event) => {
							event.preventDefault();
							pick(option);
						}}
					>
						{option.label}
						{#if option.group}
							<span class="aka">{option.group}</span>
						{/if}
						{#if option.alias}
							<span class="aka">also known as {option.alias}</span>
						{/if}
					</li>
				{:else}
					<li class="none" role="option" aria-selected="false" aria-disabled="true">
						No matching people
					</li>
				{/each}
			</ul>
		{/if}
		{#if hasSearchFailed}
			<span class="error" role="alert">Search failed</span>
		{:else if isSearching}
			<span class="sr-only" aria-live="polite">Searching</span>
		{/if}
	</div>

	{@render stepper('Ancestors', 'ancestorDepth')}
	{@render stepper('Descendants', 'descendantDepth')}

	<label class="toggle">
		<input
			type="checkbox"
			checked={view.shouldIncludeSiblings}
			onchange={(e) => onChange({ shouldIncludeSiblings: e.currentTarget.checked })}
		/>
		Siblings
	</label>
	<label
		class="toggle"
		title="Draw each partner's other families, such as the focus person's step-children"
	>
		<input
			type="checkbox"
			checked={view.shouldIncludeStepFamilies}
			onchange={(e) => onChange({ shouldIncludeStepFamilies: e.currentTarget.checked })}
		/>
		Step-family
	</label>

	<fieldset class="types">
		<legend class="caption">Show links</legend>
		{#each ALL_PARENT_CHILD_TYPES as type (type)}
			{@const style = RELATIONSHIP_STYLES[type]}
			<label class="toggle">
				<input
					type="checkbox"
					checked={view.types.includes(type)}
					onchange={() => toggleType(type)}
				/>
				<svg width="22" height="8" aria-hidden="true">
					<line
						x1="1"
						y1="4"
						x2="21"
						y2="4"
						stroke={`var(${style.colorVar})`}
						stroke-width="2"
						stroke-dasharray={style.dash ?? undefined}
						stroke-linecap={style.isRound ? 'round' : undefined}
					/>
				</svg>
				{style.label}
			</label>
		{/each}
	</fieldset>
</div>

<style>
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px 16px;
		padding: 8px 12px;
		border: 1px solid var(--tree-panel-border, #d6d3d1);
		border-radius: 12px;
		background: #fdfbf7;
		font-size: 13px;
		color: #1c1917;
	}
	.search {
		position: relative;
		display: flex;
		align-items: center;
		min-width: 15rem;
	}
	.search :global(.icon) {
		position: absolute;
		left: 8px;
		color: #78716c;
		pointer-events: none;
	}
	.search input {
		width: 100%;
		padding: 6px 8px 6px 28px;
		border: 1px solid #d6d3d1;
		border-radius: 8px;
		background: white;
	}
	.results {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		right: 0;
		z-index: 40;
		max-height: 15rem;
		overflow-y: auto;
		margin: 0;
		padding: 4px 0;
		list-style: none;
		background: white;
		border: 1px solid #d6d3d1;
		border-radius: 8px;
		box-shadow: 0 6px 18px rgb(0 0 0 / 0.16);
	}
	.results li {
		padding: 6px 10px;
		cursor: pointer;
	}
	.results li.active,
	.results li:hover {
		background: #f5f5f4;
	}
	.aka {
		display: block;
		font-size: 11px;
		color: #78716c;
	}
	.results li.none {
		color: #78716c;
		cursor: default;
	}
	.error {
		margin-left: 8px;
		color: #b91c1c;
	}
	.group,
	.types {
		display: flex;
		flex-wrap: wrap;
		min-width: 0;
		align-items: center;
		gap: 6px;
		border: 0;
		padding: 0;
		margin: 0;
	}
	.caption {
		font-weight: 600;
		color: #57534e;
	}
	.step {
		display: inline-flex;
		padding: 5px;
		border: 1px solid #d6d3d1;
		border-radius: 6px;
		background: white;
		cursor: pointer;
	}
	.step:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.step:focus-visible,
	.search input:focus-visible {
		outline: 2px solid #0f172a;
		outline-offset: 1px;
	}
	.value {
		min-width: 1.25rem;
		text-align: center;
		font-variant-numeric: tabular-nums;
		font-weight: 700;
	}
	.toggle {
		display: inline-flex;
		align-items: center;
		min-height: 24px;
		gap: 6px;
		cursor: pointer;
	}
</style>
