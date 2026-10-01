<script lang="ts">
	import { Star } from 'lucide-svelte';
	import type { MarksDto } from '#lib/shared/marks.js';

	interface Props {
		/** The tree the people belong to. */
		treeId: string;
		/** The signed-in user's favourites and recents in this tree. */
		marks: MarksDto;
	}

	/** Enough to reach back a few visits without crowding the page; the focus box lists all of them. */
	const RECENTS_SHOWN = 6;

	let { treeId, marks }: Props = $props();

	const href = (id: string) => `/trees/${encodeURIComponent(treeId)}/people/${encodeURIComponent(id)}`;
	// A favourite is not repeated among the recents beside it.
	const recents = $derived(marks.recents.filter((r) => !marks.favorites.some((f) => f.id === r.id)).slice(0, RECENTS_SHOWN));
</script>

{#if marks.favorites.length > 0 || recents.length > 0}
	<div class="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-stone-600" data-testid="marks-strip">
		{#if marks.favorites.length > 0}
			<nav aria-label="Favourites" class="flex flex-wrap items-center gap-2">
				<span class="flex items-center gap-1 font-semibold"><Star class="h-3 w-3" />Favourites</span>
				{#each marks.favorites as person (person.id)}
					<a href={href(person.id)} class="rounded-full border border-stone-300 bg-white px-2 py-0.5 font-semibold text-emerald-900 hover:bg-stone-100">{person.displayName}</a>
				{/each}
			</nav>
		{/if}
		{#if recents.length > 0}
			<nav aria-label="Recent people" class="flex flex-wrap items-center gap-2">
				<span class="font-semibold">Recent</span>
				{#each recents as person (person.id)}
					<a href={href(person.id)} class="rounded-full border border-stone-200 bg-white px-2 py-0.5 text-emerald-900 hover:bg-stone-100">{person.displayName}</a>
				{/each}
			</nav>
		{/if}
	</div>
{/if}
