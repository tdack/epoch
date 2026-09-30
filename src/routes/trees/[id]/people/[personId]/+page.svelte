<script lang="ts">
  import { ArrowDown, ArrowUp, Cross, GitBranch, MapPin, Pencil, Plus, Trash2, UserPlus } from 'lucide-svelte';
  import FactDialog from '#lib/components/modals/FactDialog.svelte';
  import { getTreeContext } from '#lib/components/tree/tree-context.js';
  import { sexLabel } from '#lib/shared/sex.js';
  import type { FactDto, PersonSummaryDto } from '#lib/server/services/person-page-service.js';
  import { deleteFactApi, previewFactApi, reorderFactsApi } from '#lib/services/tree-api.js';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
  const { editor, toasts } = getTreeContext();

  const dto = $derived(data.person);
  const treeId = $derived(data.summary.tree.id);
  const treeHref = $derived(`/trees/${encodeURIComponent(treeId)}`);
  const personHref = (id: string) => `${treeHref}/people/${encodeURIComponent(id)}`;
  const unionHref = (id: string) => `${treeHref}/unions/${encodeURIComponent(id)}`;

  // The dialogs read versions and names from the graph the screen shows.
  $effect(() => {
    editor.graph = dto.graph;
    return () => (editor.graph = null);
  });

  // ---- Facts ----
  let factDialog = $state<{ fact: FactDto | null } | null>(null);

  async function factSaved(change: Parameters<typeof editor.afterChange>[0]) {
    factDialog = null;
    await editor.afterChange(change, 'Fact saved');
  }

  async function factStale(message: string) {
    factDialog = null;
    await editor.refresh();
    toasts.push(`${message} Review the fact and try again.`, { tone: 'error', durationMs: 10_000 });
  }

  function removeFact(fact: FactDto) {
    void editor.confirmWithImpact({
      title: `Remove this ${fact.label.toLowerCase()}?`,
      confirmLabel: 'Remove fact',
      preview: () => previewFactApi(treeId, { kind: 'delete_fact', factId: fact.id, version: fact.version }),
      run: () => deleteFactApi(treeId, fact.id, fact.version),
      done: 'Fact removed'
    });
  }

  /** Facts that sort together (same date, or both undated) can swap places; a date decides the rest. */
  const canSwap = (a: FactDto | undefined, b: FactDto | undefined) => a !== undefined && b !== undefined && a.sortStart === b.sortStart;

  async function move(index: number, by: -1 | 1) {
    const order = dto.facts.map((f) => f.id);
    [order[index], order[index + by]] = [order[index + by]!, order[index]!];
    try {
      const { change } = await reorderFactsApi(treeId, dto.person.id, order);
      await editor.afterChange(change, 'Facts reordered');
    } catch (cause) {
      toasts.push((cause as Error).message || 'Could not reorder', { tone: 'error' });
    }
  }

  const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString() : 'unknown');
  const childrenOf = (list: Array<{ person: PersonSummaryDto }>) => list.map((c) => c.person);
</script>

<svelte:head>
  <title>{dto.person.displayName} · Epoch</title>
</svelte:head>

<nav aria-label="Breadcrumb" class="text-xs text-stone-600">
  <a href={treeHref} class="font-semibold text-emerald-800 hover:underline">{data.summary.tree.name}</a>
  <span aria-hidden="true"> › </span>
  <span>People</span>
  <span aria-hidden="true"> › </span>
  <span aria-current="page">{dto.person.displayName}</span>
</nav>

<header class="flex flex-wrap items-start justify-between gap-3">
  <div>
    <h2 class="text-2xl font-bold text-stone-900" data-testid="person-name">{dto.person.displayName}</h2>
    <p class="mt-1 text-sm text-stone-600">
      {sexLabel(dto.person.sex)}{#if dto.vitals.lifespan}<span aria-hidden="true"> · </span><span data-testid="lifespan">{dto.vitals.lifespan}</span>{/if}
      {#if dto.vitals.hasConflict}<span class="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900">dates disagree</span>{/if}
    </p>
    <p class="mt-1 text-xs"><a href={`${treeHref}?focus=${encodeURIComponent(dto.person.id)}`} class="inline-flex items-center gap-1 font-semibold text-emerald-800 hover:underline"><GitBranch class="h-3 w-3" />Show in the tree</a></p>
  </div>
  <div class="flex flex-wrap gap-2">
    <button type="button" onclick={() => void editor.openEditPerson(dto.person.id)} class="btn"><Pencil class="h-3.5 w-3.5" />Edit</button>
    <button type="button" onclick={() => editor.openRelationship(editor.anchorFor(dto.person.id))} class="btn"><UserPlus class="h-3.5 w-3.5" />Relationship</button>
    <button type="button" onclick={() => editor.openRelationship(editor.anchorFor(dto.person.id), { kind: 'record_death' })} class="btn"><Cross class="h-3.5 w-3.5" />Record death</button>
    <button type="button" onclick={() => editor.requestDeletePerson(dto.person.id)} class="btn text-red-700"><Trash2 class="h-3.5 w-3.5" />Delete…</button>
  </div>
</header>

<div class="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
  <div class="space-y-6">
    <section aria-labelledby="names-heading" class="card">
      <h3 id="names-heading" class="heading">Names</h3>
      <ul class="mt-2 space-y-1 text-sm" data-testid="names">
        {#each dto.names as name (name.id ?? 'derived')}
          <li>
            <span class="font-medium">{name.displayName}</span>
            <span class="text-xs text-stone-500">{name.isPreferred ? 'preferred' : name.type}</span>
          </li>
        {/each}
      </ul>
    </section>

    <section aria-labelledby="facts-heading" class="card">
      <div class="flex items-center justify-between">
        <h3 id="facts-heading" class="heading">Facts</h3>
        <button type="button" onclick={() => (factDialog = { fact: null })} class="btn"><Plus class="h-3.5 w-3.5" />Add fact</button>
      </div>
      {#if dto.facts.length === 0}
        <p class="mt-2 text-sm italic text-stone-500">No facts recorded.</p>
      {:else}
        <ol class="mt-3 space-y-2" data-testid="facts">
          {#each dto.facts as fact, index (fact.id)}
            <li
              class="rounded-xl border bg-white p-3 {fact.conflict ? 'border-amber-400' : 'border-stone-200'}"
              data-testid="fact"
              data-fact-type={fact.type}
              data-conflict={fact.conflict?.kind ?? ''}
            >
              <div class="flex flex-wrap items-baseline justify-between gap-2">
                <span class="text-sm font-semibold text-emerald-900">{fact.label}{#if fact.value}: <span class="text-stone-900">{fact.value}</span>{/if}</span>
                <span class="text-xs text-stone-600">{fact.dateText ?? 'Date unknown'}{#if fact.isApproximate} <span class="text-stone-400">(approximate)</span>{/if}</span>
              </div>
              {#if fact.place}<p class="mt-1 flex items-center text-xs text-stone-600"><MapPin class="mr-1 h-3.5 w-3.5 text-stone-400" />{fact.place}</p>{/if}
              {#if fact.cause || fact.age}
                <p class="mt-1 text-xs text-stone-600">{[fact.cause && `Cause: ${fact.cause}`, fact.age && `Age: ${fact.age}`].filter(Boolean).join(' · ')}</p>
              {/if}
              {#if fact.notes}<p class="mt-1 text-xs text-stone-700">{fact.notes}{#if fact.isLegacyNote} <span class="text-stone-400">(imported note)</span>{/if}</p>{/if}
              {#if fact.conflict}
                <p class="mt-1 text-xs font-semibold text-amber-800" role="note">
                  {fact.conflict.kind === 'repeat'
                    ? `Recorded ${fact.conflict.otherIds.length + 1} times with the same details.`
                    : `Disagrees with ${fact.conflict.otherIds.length} other recorded ${fact.label.toLowerCase()}${fact.conflict.otherIds.length > 1 ? 's' : ''}. All are kept.`}
                </p>
              {/if}
              <div class="mt-2 flex items-center gap-3 text-xs font-semibold">
                <button type="button" onclick={() => (factDialog = { fact })} class="link" aria-label={`Edit ${fact.label}`}>Edit</button>
                <button type="button" onclick={() => removeFact(fact)} class="link text-red-700" aria-label={`Remove ${fact.label}`}>Remove</button>
                {#if canSwap(dto.facts[index - 1], fact)}
                  <button type="button" onclick={() => void move(index, -1)} class="link" aria-label={`Move ${fact.label} up`}><ArrowUp class="inline h-3 w-3" /></button>
                {/if}
                {#if canSwap(fact, dto.facts[index + 1])}
                  <button type="button" onclick={() => void move(index, 1)} class="link" aria-label={`Move ${fact.label} down`}><ArrowDown class="inline h-3 w-3" /></button>
                {/if}
              </div>
            </li>
          {/each}
        </ol>
      {/if}
    </section>

    <div class="grid gap-6 sm:grid-cols-2">
      <section aria-labelledby="notes-heading" class="card">
        <h3 id="notes-heading" class="heading">Notes</h3>
        <p class="mt-2 text-xs text-stone-500">Notes on a person arrive with sources and evidence in a later phase.</p>
      </section>
      <section aria-labelledby="evidence-heading" class="card">
        <h3 id="evidence-heading" class="heading">Sources and evidence</h3>
        <p class="mt-2 text-xs text-stone-500">Citations are not recorded yet.</p>
      </section>
    </div>

    {#if dto.media.length > 0}
      <section aria-labelledby="media-heading" class="card">
        <h3 id="media-heading" class="heading">Media</h3>
        <ul class="mt-2 space-y-1 text-sm">
          {#each dto.media as item (item.id)}
            <li><a class="link" href={`/api/media/${item.r2ObjectKey}`} target="_blank" rel="noreferrer">{item.title ?? item.r2ObjectKey}</a></li>
          {/each}
        </ul>
      </section>
    {/if}
  </div>

  <aside class="space-y-6" aria-label="Family">
    <section aria-labelledby="parents-heading" class="card">
      <h3 id="parents-heading" class="heading">Parents</h3>
      {#if dto.parentFamilies.length === 0}<p class="mt-2 text-xs italic text-stone-500">None recorded.</p>{/if}
      {#each dto.parentFamilies as family (family.unionId ?? 'direct')}
        <ul class="mt-2 space-y-1 text-sm" data-testid="parents">
          {#each family.parents as parent (parent.person.id + parent.type)}
            <li><a class="link" href={personHref(parent.person.id)}>{parent.person.displayName}</a> <span class="text-xs text-stone-500">{parent.type === 'biological' ? '' : parent.type}</span></li>
          {/each}
          {#if family.unionId}<li class="text-xs"><a class="link" href={unionHref(family.unionId)}>{family.label?.full ?? 'Their partnership'}</a></li>{/if}
        </ul>
      {/each}
    </section>

    <section aria-labelledby="partners-heading" class="card">
      <h3 id="partners-heading" class="heading">Partnerships and children</h3>
      {#if dto.partnerships.length === 0 && dto.directChildren.length === 0}<p class="mt-2 text-xs italic text-stone-500">None recorded.</p>{/if}
      {#each dto.partnerships as union (union.unionId)}
        <div class="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 p-2.5" data-testid="partnership">
          <p class="text-xs font-semibold text-amber-900">
            <a class="link" href={unionHref(union.unionId)}>{union.label?.full ?? 'Partnership'}</a>
            {#if union.status !== 'active'}<span class="text-red-700"> · {union.status}</span>{/if}
            {#if union.isWidowed}<span class="text-stone-700"> · widowed</span>{/if}
          </p>
          <ul class="mt-1 space-y-0.5 text-sm">
            {#each union.partners as partner (partner.id)}
              <li><a class="link" href={personHref(partner.id)}>{partner.displayName}</a>{#if partner.isDeceased} <span class="text-xs text-stone-500">(deceased)</span>{/if}</li>
            {/each}
          </ul>
          {#if union.children.length > 0}
            <p class="mt-2 text-[11px] font-semibold uppercase tracking-wide text-stone-500">Children</p>
            <ul class="space-y-0.5 text-sm">
              {#each childrenOf(union.children) as child (child.id)}
                <li><a class="link" href={personHref(child.id)}>{child.displayName}</a></li>
              {/each}
            </ul>
          {/if}
        </div>
      {/each}
      {#if dto.directChildren.length > 0}
        <p class="mt-3 text-[11px] font-semibold uppercase tracking-wide text-stone-500">Children (no partnership recorded)</p>
        <ul class="space-y-0.5 text-sm">
          {#each childrenOf(dto.directChildren) as child (child.id)}
            <li><a class="link" href={personHref(child.id)}>{child.displayName}</a></li>
          {/each}
        </ul>
      {/if}
    </section>

    <section aria-labelledby="siblings-heading" class="card">
      <h3 id="siblings-heading" class="heading">Siblings</h3>
      {#if dto.siblings.full.length === 0 && dto.siblings.half.length === 0}<p class="mt-2 text-xs italic text-stone-500">None recorded.</p>{/if}
      <ul class="mt-2 space-y-0.5 text-sm" data-testid="siblings">
        {#each dto.siblings.full as sibling (sibling.id)}<li><a class="link" href={personHref(sibling.id)}>{sibling.displayName}</a></li>{/each}
        {#each dto.siblings.half as sibling (sibling.id)}<li><a class="link" href={personHref(sibling.id)}>{sibling.displayName}</a> <span class="text-xs text-stone-500">half-sibling</span></li>{/each}
      </ul>
    </section>

    {#if dto.stepParents.length > 0 || dto.stepChildren.length > 0}
      <section aria-labelledby="steps-heading" class="card">
        <h3 id="steps-heading" class="heading">Step relatives</h3>
        <ul class="mt-2 space-y-0.5 text-sm" data-testid="step-relatives">
          {#each dto.stepParents as step (step.person.id)}<li><a class="link" href={personHref(step.person.id)}>{step.person.displayName}</a> <span class="text-xs text-stone-500">step-parent</span></li>{/each}
          {#each dto.stepChildren as step (step.person.id)}<li><a class="link" href={personHref(step.person.id)}>{step.person.displayName}</a> <span class="text-xs text-stone-500">step-child, via {step.via.displayName}</span></li>{/each}
        </ul>
      </section>
    {/if}

    <section aria-labelledby="history-heading" class="card">
      <h3 id="history-heading" class="heading">History</h3>
      <p class="mt-1 text-xs text-stone-500">Created {when(dto.changes.createdAt)} · last written {when(dto.changes.updatedAt)}</p>
      {#if dto.changes.recent.length === 0}
        <p class="mt-2 text-xs italic text-stone-500">No changes are logged for this person. Imported records have no history.</p>
      {:else}
        <ul class="mt-2 space-y-1.5 text-xs" data-testid="history">
          {#each dto.changes.recent as change (change.id)}
            <li>
              <span class="font-medium text-stone-800">{change.summary}</span>
              <span class="block text-stone-500">{change.actorName ?? 'Someone'} · {when(change.createdAt)}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </aside>
</div>

<FactDialog
  show={factDialog !== null}
  {treeId}
  personId={dto.person.id}
  fact={factDialog?.fact ?? null}
  onsaved={factSaved}
  onstale={factStale}
  oncancel={() => (factDialog = null)}
/>

<style>
  .card {
    border-radius: 1rem;
    border: 1px solid var(--color-stone-200);
    background: var(--color-stone-50);
    padding: 1rem;
  }
  .heading {
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--color-stone-600);
  }
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    cursor: pointer;
    border-radius: 0.5rem;
    border: 1px solid var(--color-stone-300);
    background: var(--color-stone-100);
    padding: 0.375rem 0.75rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-stone-800);
  }
  .btn:hover {
    background: var(--color-stone-200);
  }
  .link {
    cursor: pointer;
    font-weight: 500;
    color: var(--color-emerald-800);
  }
  .link:hover {
    text-decoration: underline;
  }
</style>
