<script lang="ts">
	import PlaceInput from '#lib/components/forms/PlaceInput.svelte';
	import { Search } from '@lucide/svelte';
	import Pager from '#lib/components/lists/Pager.svelte';
	import { lifeDates } from '#lib/shared/life-dates.js';
	import { NAME_TYPE_LABELS, isNameType } from '#lib/shared/name-types.js';
	import { DEFAULT_SEARCH_LIMIT, type SearchMatch } from '#lib/shared/search.js';
	import type { PageData } from './$types';
	import { treePath } from '#lib/shared/tree-slug.js';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	const base = $derived(treePath(data.summary.tree));
	const query = $derived(data.query);
	const response = $derived(data.response);
	// Seeded from the URL; the form is a plain GET, so this only drives the suggestions.
	let placeText = $derived(query.place);

	const personHref = (id: string) => `${base}/people/${encodeURIComponent(id)}`;

	function searchHref(offset: number): string {
		const params = new URLSearchParams();
		for (const [key, value] of [
			['q', query.text],
			['place', query.place],
			['from', query.from],
			['to', query.to]
		] as const) {
			if (value) params.set(key, value);
		}
		if (offset > 0) params.set('offset', String(offset));
		return `${base}/search?${params}`;
	}

	const nameTypeLabel = (type: string) => (isNameType(type) ? NAME_TYPE_LABELS[type] : 'Name');

	/** One line saying why a result is here. */
	function describe(match: SearchMatch): string {
		if (match.kind === 'xref') return `XREF ${match.text}`;
		if (match.kind === 'name')
			return match.isDisplayName
				? `Name: ${match.text}`
				: `Also known as ${match.text} (${nameTypeLabel(match.nameType).toLowerCase()})`;
		const where = [match.dateText, match.placeText].filter(Boolean).join(' in ');
		return `${match.label}${match.isPartnershipFact ? ' (partnership)' : ''}: ${where || 'no date or place'}`;
	}
</script>

<svelte:head>
	<title>Search · {data.summary.tree.name} · Epoch</title>
</svelte:head>

<header>
	<h1 class="text-2xl font-bold text-stone-900">Search</h1>
	<p class="mt-1 text-sm text-stone-600">
		Any name a person has, a surname, a nickname, an XREF, a place, or a range of years.
	</p>
</header>

<form
	method="GET"
	action="{base}/search"
	class="grid gap-3 rounded-xl border border-stone-200 bg-white p-4 sm:grid-cols-[2fr_2fr_1fr_1fr_auto]"
	role="search"
>
	<label class="flex flex-col gap-1 text-xs font-semibold text-stone-700">
		Name or XREF
		<!-- svelte-ignore a11y_autofocus -->
		<input
			name="q"
			type="search"
			value={query.text}
			autofocus
			autocomplete="off"
			class="field"
			data-testid="search-q"
		/>
	</label>
	<label class="flex flex-col gap-1 text-xs font-semibold text-stone-700">
		Place contains
		<PlaceInput
			id="search-place"
			name="place"
			type="search"
			treeId={data.summary.tree.id}
			bind:value={placeText}
			inputClass="field"
			data-testid="search-place"
		/>
	</label>
	<label class="flex flex-col gap-1 text-xs font-semibold text-stone-700">
		From year
		<input
			name="from"
			inputmode="numeric"
			value={query.from}
			placeholder="1850"
			class="field"
			data-testid="search-from"
		/>
	</label>
	<label class="flex flex-col gap-1 text-xs font-semibold text-stone-700">
		To year
		<input
			name="to"
			inputmode="numeric"
			value={query.to}
			placeholder="1900"
			class="field"
			data-testid="search-to"
		/>
	</label>
	<button type="submit" class="btn-primary gap-1.5 self-end">
		<Search class="h-4 w-4" />Search
	</button>
</form>

{#if response === null}
	<p class="text-sm text-stone-600">
		Type a name, or narrow by place and years. A place and a year range must hold on the same fact,
		so "Cork, 1850 to 1860" means born, married or died in Cork in those years.
	</p>
{:else if response.people.length === 0}
	<p class="text-sm text-stone-700" data-testid="search-empty">
		No one matches. Try fewer words, or widen the years.
	</p>
{:else}
	<ul
		class="divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white"
		aria-label="Search results"
		data-testid="search-results"
	>
		{#each response.people as person (person.id)}
			<li class="flex flex-col gap-1 px-4 py-3">
				<div class="flex flex-wrap items-baseline justify-between gap-2">
					<a
						href={personHref(person.id)}
						class="font-semibold text-emerald-900 hover:underline"
						data-testid="search-result">{person.displayName}</a
					>
					<span class="text-xs text-stone-500"
						>{lifeDates(person.birthDate, person.deathDate, person.isDeceased)}</span
					>
				</div>
				<ul class="text-xs text-stone-600" aria-label="Why this matched">
					{#each person.matches as match, i (i)}
						<li>{describe(match)}</li>
					{/each}
				</ul>
			</li>
		{/each}
	</ul>
	<Pager
		summary="Showing {query.offset + 1} to {query.offset + response.people.length}"
		previousHref={query.offset > 0
			? searchHref(Math.max(0, query.offset - DEFAULT_SEARCH_LIMIT))
			: null}
		nextHref={response.hasMore ? searchHref(query.offset + DEFAULT_SEARCH_LIMIT) : null}
	/>
{/if}

<style>
	.field {
		padding: 6px 8px;
		border: 1px solid #d6d3d1;
		border-radius: 8px;
		background: white;
		font-weight: 400;
		color: #1c1917;
	}
</style>
