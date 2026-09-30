<script lang="ts">
  import Pager from '#lib/components/lists/Pager.svelte';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();

  const base = $derived(`/trees/${encodeURIComponent(data.summary.tree.id)}`);
  const page = $derived(data.page);
  const pageHref = (offset: number) => `${base}/surnames${offset > 0 ? `?offset=${offset}` : ''}`;
</script>

<svelte:head>
  <title>Surnames · {data.summary.tree.name} · Epoch</title>
</svelte:head>

<header>
  <h2 class="text-2xl font-bold text-stone-900">Surnames</h2>
  <p class="mt-1 text-sm text-stone-600">Every surname on any name a person has. A person counts once under each surname they carry.</p>
</header>

{#if page.items.length === 0}
  <p class="text-sm text-stone-700">No surnames recorded.</p>
{:else}
  <ul class="divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white" data-testid="surnames-list">
    {#each page.items as item (item.surname)}
      <li class="flex items-baseline justify-between px-4 py-2 text-sm">
        <a href="{base}/people?surname={encodeURIComponent(item.surname)}" class="font-semibold text-emerald-900 hover:underline">{item.surname}</a>
        <span class="text-stone-600">{item.people} {item.people === 1 ? 'person' : 'people'}</span>
      </li>
    {/each}
  </ul>
  <Pager
    summary="Showing {page.offset + 1} to {page.offset + page.items.length}"
    previousHref={page.offset > 0 ? pageHref(Math.max(0, page.offset - page.limit)) : null}
    nextHref={page.hasMore ? pageHref(page.offset + page.limit) : null}
  />
{/if}
