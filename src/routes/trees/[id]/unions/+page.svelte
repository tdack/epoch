<script lang="ts">
	import { dateReader } from '#lib/components/date-format.js';
	import Pager from '#lib/components/lists/Pager.svelte';
	import { UNION_STATUS_LABELS } from '#lib/shared/union-events.js';
	import type { UnionStatus } from '#lib/shared/relationship-model.js';
	import type { PageData } from './$types';
	import { treePath } from '#lib/shared/tree-slug.js';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();
	const showDate = dateReader();

	const base = $derived(treePath(data.summary.tree));
	const page = $derived(data.page);
	const pageHref = (offset: number) => `${base}/unions${offset > 0 ? `?offset=${offset}` : ''}`;
</script>

<svelte:head>
	<title>Partnerships · {data.summary.tree.name} · Epoch</title>
</svelte:head>

<header>
	<h1 class="text-2xl font-bold text-stone-900">Partnerships</h1>
	<p class="mt-1 text-sm text-stone-600">
		In the order they were added. A partnership is not assumed to be a marriage.
	</p>
</header>

{#if page.items.length === 0}
	<p class="text-sm text-stone-700">No partnerships yet.</p>
{:else}
	<table
		class="w-full rounded-xl border border-stone-200 bg-white text-left text-sm"
		data-testid="unions-list"
	>
		<thead class="text-xs text-stone-500 uppercase">
			<tr>
				<th scope="col" class="px-4 py-2">Partners</th>
				<th scope="col" class="px-4 py-2">Status</th>
				<th scope="col" class="px-4 py-2">Married</th>
				<th scope="col" class="px-4 py-2">Ended</th>
			</tr>
		</thead>
		<tbody class="divide-y divide-stone-200">
			{#each page.items as union (union.id)}
				<tr>
					<td class="px-4 py-2">
						<a
							href="{base}/unions/{encodeURIComponent(union.id)}"
							class="font-semibold text-emerald-900 hover:underline"
						>
							{union.partners.map((p) => p.displayName).join(' and ') || 'Partnership'}
						</a>
					</td>
					<td class="px-4 py-2 text-stone-600"
						>{UNION_STATUS_LABELS[union.status as UnionStatus] ?? union.status}</td
					>
					<td class="px-4 py-2 text-stone-600"
						>{[showDate(union.marriageDate), union.marriagePlace].filter(Boolean).join(' in ')}</td
					>
					<td class="px-4 py-2 text-stone-600">{showDate(union.endDate)}</td>
				</tr>
			{/each}
		</tbody>
	</table>
	<Pager
		summary="Showing {page.offset + 1} to {page.offset + page.items.length}"
		previousHref={page.offset > 0 ? pageHref(Math.max(0, page.offset - page.limit)) : null}
		nextHref={page.hasMore ? pageHref(page.offset + page.limit) : null}
	/>
{/if}
