<script lang="ts">
	import Pager from '#lib/components/lists/Pager.svelte';
	import { INDIVIDUAL_SORTS, type IndividualSort } from '#lib/shared/lists.js';
	import { lifeDates } from '#lib/shared/life-dates.js';
	import type { PageData } from './$types';
	import { treePath } from '#lib/shared/tree-slug.js';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	const base = $derived(treePath(data.summary.tree));
	const page = $derived(data.page);

	function listHref(change: { sort?: IndividualSort; offset?: number; surname?: string }): string {
		const params = new URLSearchParams();
		const sort = change.sort ?? data.sort;
		const surname = change.surname ?? data.surname;
		if (sort !== INDIVIDUAL_SORTS.SURNAME) params.set('sort', sort);
		if (surname) params.set('surname', surname);
		if (change.offset) params.set('offset', String(change.offset));
		const query = params.toString();
		return `${base}/people${query ? `?${query}` : ''}`;
	}
</script>

<svelte:head>
	<title>People · {data.summary.tree.name} · Epoch</title>
</svelte:head>

<header class="flex flex-wrap items-end justify-between gap-3">
	<div>
		<h2 class="text-2xl font-bold text-stone-900">
			People{#if data.surname}<span class="font-normal"> named {data.surname}</span>{/if}
		</h2>
		{#if data.surname}
			<p class="mt-1 text-sm">
				<a href={listHref({ surname: '', offset: 0 })} class="text-link">Show everyone</a>
			</p>
		{/if}
	</div>
	<div class="flex items-center gap-2 text-sm" role="group" aria-label="Sort by">
		<span class="text-stone-600">Sort by</span>
		<a
			href={listHref({ sort: INDIVIDUAL_SORTS.SURNAME, offset: 0 })}
			aria-current={data.sort === INDIVIDUAL_SORTS.SURNAME ? 'true' : undefined}
			class="sort"
			class:on={data.sort === INDIVIDUAL_SORTS.SURNAME}>Surname</a
		>
		<a
			href={listHref({ sort: INDIVIDUAL_SORTS.GIVEN, offset: 0 })}
			aria-current={data.sort === INDIVIDUAL_SORTS.GIVEN ? 'true' : undefined}
			class="sort"
			class:on={data.sort === INDIVIDUAL_SORTS.GIVEN}>Given name</a
		>
	</div>
</header>

{#if page.items.length === 0}
	<p class="text-sm text-stone-700">No one here.</p>
{:else}
	<table
		class="w-full rounded-xl border border-stone-200 bg-white text-left text-sm"
		data-testid="people-list"
	>
		<thead class="text-xs text-stone-500 uppercase">
			<tr
				><th scope="col" class="px-4 py-2">Name</th><th scope="col" class="px-4 py-2">Life</th><th
					scope="col"
					class="px-4 py-2">XREF</th
				></tr
			>
		</thead>
		<tbody class="divide-y divide-stone-200">
			{#each page.items as person (person.id)}
				<tr>
					<td class="px-4 py-2"
						><a
							href="{base}/people/{encodeURIComponent(person.id)}"
							class="font-semibold text-emerald-900 hover:underline">{person.displayName}</a
						></td
					>
					<td class="px-4 py-2 text-stone-600"
						>{lifeDates(person.birthDate, person.deathDate, person.isDeceased)}</td
					>
					<td class="px-4 py-2 text-stone-500">{person.xref ?? ''}</td>
				</tr>
			{/each}
		</tbody>
	</table>
	<Pager
		summary="Showing {page.offset + 1} to {page.offset + page.items.length}"
		previousHref={page.offset > 0
			? listHref({ offset: Math.max(0, page.offset - page.limit) })
			: null}
		nextHref={page.hasMore ? listHref({ offset: page.offset + page.limit }) : null}
	/>
{/if}

<style>
	.sort {
		padding: 2px 10px;
		border: 1px solid #d6d3d1;
		border-radius: 999px;
		font-weight: 600;
		color: #1c1917;
	}
	.sort.on {
		background: #065f46;
		border-color: #065f46;
		color: white;
	}
</style>
