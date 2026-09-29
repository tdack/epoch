<script lang="ts">
  import { X, MapPin, FileText, Upload, Image as ImageIcon, UserPlus, Pencil, Trash2, Cross } from 'lucide-svelte';
  import { sexLabel } from '#lib/shared/sex.js';
  import { stepRelativesOf } from '#lib/shared/step-relatives.js';
  import { widowhoods } from '#lib/shared/widowhood.js';
  import { startSort, type PartnershipLabel } from '#lib/shared/partnership-labels.js';
  import type {
    RelationshipGraph,
    RelationshipGraphPerson
  } from '#lib/server/domain/relationship-graph.js';

  interface Props {
    person: any | null;
    treeId: string;
    graph: RelationshipGraph;
    onClose: () => void;
    onMediaUploaded?: () => void;
    onSelectPerson?: (id: string) => void;
    onAddRelationship?: (person: any) => void;
    onEditPerson?: (person: any) => void;
    /** Ask to delete the person; the caller previews exactly what goes and confirms. */
    onDeletePerson?: (person: any) => void;
    /** Open the death form for this person. */
    onRecordDeath?: (person: any) => void;
    /** Open the partnership editor. */
    onEditUnion?: (unionId: string) => void;
    /** Open the end-partnership form on this partnership. */
    onEndUnion?: (unionId: string) => void;
    /** Open the merge dialog for a partnership that has a twin between the same people. */
    onMergeUnion?: (unionId: string) => void;
    /** Unions that have a twin between the same people, and so can be merged. */
    mergeableUnionIds?: Set<string>;
    /** Chronological labels for repeated partnerships, by union id. */
    partnershipLabels?: Map<string, PartnershipLabel>;
  }

  let {
    person,
    treeId,
    graph,
    onClose,
    onMediaUploaded,
    onSelectPerson,
    onAddRelationship,
    onEditPerson,
    onDeletePerson,
    onRecordDeath,
    onEditUnion,
    onEndUnion,
    onMergeUnion,
    mergeableUnionIds,
    partnershipLabels
  }: Props = $props();

  // Widowhood is derived, never stored: a partner is widowed in a partnership that has not ended
  // when the other partner has died.
  const widowedUnionIds = $derived.by(() => {
    const deceased = new Set(graph.people.filter((p) => p.isDeceased).map((p) => p.id));
    const unions = graph.unions.map((u) => ({ id: u.id, status: u.status, partnerIds: u.partnerIds }));
    return new Set(widowhoods(unions, deceased).filter((w) => w.widowId === person?.id).map((w) => w.unionId));
  });

  function nameOf(id: string | null | undefined): string {
    if (!id) return '';
    const p = graph.people.find((g) => g.id === id);
    return p?.displayName || id;
  }

  function graphPersonFor(id: string): RelationshipGraphPerson | null {
    return graph.people.find((g) => g.id === id) || null;
  }

  function isDeceased(id: string): boolean {
    return graph.people.find((g) => g.id === id)?.isDeceased ?? false;
  }

  // Union IDs where this person is recorded as a child, keyed by union.
  let parentGroups = $derived.by(() => {
    const gp = person ? graphPersonFor(person.id) : null;
    return gp ? gp.parentsByUnion : {};
  });

  // Every partnership the person is in, exactly as stored. `parent_child` asserts one row per
  // parent, so a child of a two-parent union repeats once per parent; that is the only thing
  // collapsed here. Repeated partnerships between the same pair stay separate and are told apart
  // by their chronological labels.
  let partnerUnions = $derived.by(() => {
    const gp = person ? graphPersonFor(person.id) : null;
    if (!gp) return [];
    // Oldest first, as the detail panel should read; undated partnerships follow in stored order.
    const byStart = (a: { events?: Array<{ type: string; dateSort?: string | null; dateText: string | null }> }, b: typeof a) => {
      const [sa, sb] = [startSort({ id: '', partnerIds: [], events: a.events }), startSort({ id: '', partnerIds: [], events: b.events })];
      return sa && sb ? sa.localeCompare(sb) : sa ? -1 : sb ? 1 : 0;
    };
    return graph.unions
      .filter((u) => gp.unionIds.includes(u.id))
      .sort(byStart)
      .map((u) => {
        const seen = new Set<string>();
        return {
          ...u,
          children: u.children.filter((c) => {
            if (seen.has(c.childId)) return false;
            seen.add(c.childId);
            return true;
          })
        };
      });
  });

  // Derived from partnerships, never stored; shown apart from parents and children so they are not mistaken for either.
  const steps = $derived(person ? stepRelativesOf(graph, person.id) : { stepParents: [], stepChildren: [] });

  let uploading = $state(false);
  let uploadError = $state<string | null>(null);
  let fileInput: HTMLInputElement | null = $state(null);
  async function handleFileUpload(e: Event) {
    const target = e.target as HTMLInputElement;
    if (!target.files || target.files.length === 0 || !person) return;

    const file = target.files[0];
    uploading = true;
    uploadError = null;

    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('treeId', treeId);
      fd.append('entityId', person.id);
      fd.append('title', file.name);

      const res = await fetch('/api/media/upload', {
        method: 'POST',
        body: fd
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || 'Upload failed');
      }

      onMediaUploaded?.();
    } catch (err: any) {
      uploadError = err.message;
    } finally {
      uploading = false;
      if (fileInput) fileInput.value = '';
    }
  }
</script>

{#if person}
  <div class="fixed inset-y-0 right-0 z-50 w-full sm:w-96 bg-[#fcfaf5]/98 backdrop-blur-xl border-l border-stone-300 shadow-2xl flex flex-col transition-transform duration-300">
    <!-- Header -->
    <div class="p-6 border-b border-stone-200/90 flex items-start justify-between bg-[#fbf8f0]">
      <div>
        <h2 class="text-xl font-bold text-stone-900">{person.name}</h2>
        <p class="text-xs text-stone-500 mt-0.5">XREF: <span class="font-mono text-emerald-800 font-medium">{person.id}</span></p>
      </div>
      <div class="flex items-center space-x-1">
        {#if onRecordDeath}
          <button
            type="button"
            onclick={() => onRecordDeath(person)}
            title="Record death"
            aria-label="Record death"
            class="text-stone-500 hover:text-emerald-800 p-1.5 rounded-lg hover:bg-stone-200/60 transition-colors cursor-pointer"
          >
            <Cross class="w-4 h-4" />
          </button>
        {/if}
        {#if onEditPerson}
          <button
            type="button"
            onclick={() => onEditPerson(person)}
            title="Edit Person Details"
            aria-label="Edit person details"
            class="text-stone-500 hover:text-emerald-800 p-1.5 rounded-lg hover:bg-stone-200/60 transition-colors cursor-pointer"
          >
            <Pencil class="w-4 h-4" />
          </button>
        {/if}
        <button
          type="button"
          onclick={onClose}
          aria-label="Close details"
          class="text-stone-400 hover:text-stone-800 p-1.5 rounded-lg hover:bg-stone-200/60 transition-colors cursor-pointer"
        >
          <X class="w-5 h-5" />
        </button>
      </div>
    </div>

    <!-- Body -->
    <div class="flex-1 overflow-y-auto p-6 space-y-6">
      <!-- Profile & Basic Info -->
      <div class="flex items-center space-x-4 bg-stone-50/80 p-3.5 rounded-xl border border-stone-200">
        {#if person.photoUrl}
          <img src={person.photoUrl} alt={person.name} class="w-16 h-16 rounded-full object-cover border-2 border-emerald-700 shadow-sm" />
        {:else}
          <div class="w-16 h-16 rounded-full bg-emerald-50 border-2 border-emerald-300 flex items-center justify-center text-emerald-800 shadow-xs">
            <span class="text-xl font-bold uppercase">{person.name?.slice(0, 2) || 'UN'}</span>
          </div>
        {/if}
        <div class="flex-1 min-w-0">
          <p class="text-sm font-semibold text-stone-800">Sex: <span class="font-normal text-stone-600">{sexLabel(person.sex)}</span></p>
          {#if person.dates}
            <p class="text-xs text-stone-500 mt-1">{person.dates}</p>
          {/if}
        </div>
        {#if onAddRelationship}
          <button
            type="button"
            onclick={() => onAddRelationship(person)}
            class="text-xs font-semibold text-emerald-800 hover:text-emerald-700 bg-emerald-50 hover:bg-emerald-100/80 px-2.5 py-1.5 rounded-lg border border-emerald-200 transition-colors cursor-pointer inline-flex items-center space-x-1"
          >
            <UserPlus class="w-3 h-3" />
            <span>Relationship</span>
          </button>
        {/if}
      </div>

      <!-- Families (close relatives) -->
      <div class="space-y-3">
        <h3 class="text-xs font-bold uppercase tracking-wider text-stone-600">Families</h3>

        {#each Object.entries(parentGroups) as [unionKey, parents] (unionKey)}
          <div class="bg-stone-50/90 rounded-xl p-3 border border-stone-200 shadow-xs space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">
                {parents.length > 1 ? 'Parents' : 'Parent'}
              </span>
            </div>
            {#each parents as parent (parent.parentId + parent.type)}
              <button
                type="button"
                onclick={() => onSelectPerson?.(parent.parentId)}
                class="w-full text-left flex items-center justify-between bg-white rounded-lg px-2.5 py-1.5 border border-stone-200 hover:border-emerald-500 transition-colors cursor-pointer group"
              >
                <span class="text-xs font-medium text-stone-800 group-hover:text-emerald-800">
                  {nameOf(parent.parentId)}
                  <span class="text-stone-600 font-normal">({parent.type})</span>
                </span>
              </button>
            {/each}
          </div>
        {/each}

        {#each partnerUnions as union (union.id)}
          <div class="bg-amber-50/70 rounded-xl p-3 border border-amber-200/80 shadow-xs space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-[11px] font-semibold text-amber-800 uppercase tracking-wide">
                {partnershipLabels?.get(union.id)?.full ?? 'Partner & Children'}
                {#if union.status !== 'active'}<span class="text-red-700">· {union.status}</span>{/if}
                {#if widowedUnionIds.has(union.id)}<span class="text-stone-700">· widowed</span>{/if}
              </span>
              <span class="flex items-center gap-2">
                {#if onEditUnion}
                  <button type="button" onclick={() => onEditUnion(union.id)} class="text-[11px] font-semibold text-emerald-800 hover:underline cursor-pointer">Edit</button>
                {/if}
                {#if onMergeUnion && mergeableUnionIds?.has(union.id)}
                  <button type="button" onclick={() => onMergeUnion(union.id)} class="text-[11px] font-semibold text-emerald-800 hover:underline cursor-pointer">Merge…</button>
                {/if}
                {#if onEndUnion && union.status === 'active'}
                  <button type="button" onclick={() => onEndUnion(union.id)} class="text-[11px] font-semibold text-emerald-800 hover:underline cursor-pointer">End</button>
                {/if}
              </span>
            </div>
            {#each union.partnerIds.filter((id) => id !== person.id) as partnerId (partnerId)}
              <button
                type="button"
                onclick={() => onSelectPerson?.(partnerId)}
                class="w-full text-left flex items-center justify-between bg-white rounded-lg px-2.5 py-1.5 border border-stone-200 hover:border-emerald-500 transition-colors cursor-pointer group"
              >
                <span class="text-xs font-medium text-stone-800 group-hover:text-emerald-800">
                  {nameOf(partnerId)}
                  <span class="text-stone-600 font-normal">({isDeceased(partnerId) ? 'deceased' : 'partner'})</span>
                </span>
              </button>
            {/each}
            {#if union.children.length}
              <div class="space-y-1 pt-0.5">
                <span class="text-[10px] font-semibold text-stone-500 uppercase tracking-wide">Children</span>
                {#each union.children as child (child.childId)}
                  <button
                    type="button"
                    onclick={() => onSelectPerson?.(child.childId)}
                    class="w-full text-left flex items-center justify-between bg-white rounded-lg px-2.5 py-1.5 border border-stone-200 hover:border-emerald-500 transition-colors cursor-pointer group"
                  >
                    <span class="text-xs font-medium text-stone-800 group-hover:text-emerald-800">
                      {nameOf(child.childId)}
                      <span class="text-stone-600 font-normal">{child.childId === person.id ? '(this person)' : ''}</span>
                    </span>
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        {/each}

        {#if steps.stepParents.length > 0 || steps.stepChildren.length > 0}
          <div class="bg-stone-50/90 rounded-xl p-3 border border-stone-200 shadow-xs space-y-2" data-testid="step-relatives">
            <span class="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">Step relatives</span>
            {#each steps.stepParents as step (step.personId)}
              <button
                type="button"
                onclick={() => onSelectPerson?.(step.personId)}
                class="w-full text-left flex items-center justify-between bg-white rounded-lg px-2.5 py-1.5 border border-stone-200 hover:border-emerald-500 transition-colors cursor-pointer group"
              >
                <span class="text-xs font-medium text-stone-800 group-hover:text-emerald-800">
                  {nameOf(step.personId)}
                  <span class="text-stone-600 font-normal">(step-parent)</span>
                </span>
              </button>
            {/each}
            {#each steps.stepChildren as step (step.personId)}
              <button
                type="button"
                onclick={() => onSelectPerson?.(step.personId)}
                class="w-full text-left flex items-center justify-between bg-white rounded-lg px-2.5 py-1.5 border border-stone-200 hover:border-emerald-500 transition-colors cursor-pointer group"
              >
                <span class="text-xs font-medium text-stone-800 group-hover:text-emerald-800">
                  {nameOf(step.personId)}
                  <span class="text-stone-600 font-normal">(step-child, via {nameOf(step.viaPartnerId)})</span>
                </span>
              </button>
            {/each}
          </div>
        {/if}

        <!-- Add-relationship action -->
        <div class="bg-stone-100/70 border border-stone-200 rounded-xl p-3 space-y-2">
          <button
            type="button"
            onclick={() => onAddRelationship?.(person)}
            class="w-full text-left text-xs font-medium text-emerald-800 hover:text-emerald-950 hover:bg-white rounded-lg px-2 py-1.5 transition-colors cursor-pointer"
          >
            + Add parents, partner, or child
          </button>
        </div>
      </div>

      <!-- Events List -->
      <div class="space-y-3">
        <h3 class="text-xs font-bold uppercase tracking-wider text-stone-600">Life Events</h3>
        {#if !person.raw?.events || person.raw.events.length === 0}
          <p class="text-xs text-stone-500 italic">No events recorded</p>
        {:else}
          <div class="space-y-2">
            {#each person.raw.events as ev (ev.id)}
              <div class="bg-stone-50/90 rounded-xl p-3 border border-stone-200 shadow-xs">
                <div class="flex items-center justify-between text-xs font-semibold text-emerald-800">
                  <span>{ev.type}</span>
                  <span class="text-stone-500 font-normal">{ev.dateRaw || 'Date unknown'}</span>
                </div>
                {#if ev.place}
                  <div class="flex items-center text-xs text-stone-600 mt-1.5">
                    <MapPin class="w-3.5 h-3.5 mr-1 text-stone-400 shrink-0" />
                    <span>{ev.place}</span>
                  </div>
                {/if}
                {#if ev.description}
                  <p class="text-xs text-stone-700 mt-1">{ev.description}</p>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Media & Documents Gallery -->
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="text-xs font-bold uppercase tracking-wider text-stone-600">Attached Media (R2)</h3>
          <label class="cursor-pointer inline-flex items-center text-xs font-semibold text-emerald-800 hover:text-emerald-700">
            <Upload class="w-3.5 h-3.5 mr-1" />
            <span>Upload</span>
            <input
              bind:this={fileInput}
              type="file"
              accept="image/*,application/pdf"
              onchange={handleFileUpload}
              class="hidden"
            />
          </label>
        </div>

        {#if uploading}
          <p class="text-xs text-emerald-800 font-medium animate-pulse">Uploading to Cloudflare R2 storage...</p>
        {/if}
        {#if uploadError}
          <p class="text-xs text-orange-700 font-medium">{uploadError}</p>
        {/if}

        {#if !person.raw?.media || person.raw.media.length === 0}
          <div class="border border-dashed border-stone-300 rounded-xl p-4 text-center text-xs text-stone-500 bg-stone-50/50">
            <ImageIcon class="w-6 h-6 mx-auto mb-1 text-stone-400" />
            No photos or historical documents attached
          </div>
        {:else}
          <div class="grid grid-cols-2 gap-2">
            {#each person.raw.media as item (item.id)}
              <a
                href={`/api/media/${item.r2ObjectKey}`}
                target="_blank"
                rel="noreferrer"
                class="group relative bg-stone-100 rounded-lg overflow-hidden border border-stone-300 aspect-square flex flex-col items-center justify-center hover:border-emerald-600 transition-colors"
              >
                {#if item.mimeType?.startsWith('image/')}
                  <img src={`/api/media/${item.r2ObjectKey}`} alt={item.title || 'Media'} class="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                {:else}
                  <FileText class="w-8 h-8 text-stone-500" />
                  <span class="text-[10px] text-stone-700 mt-1 px-1 truncate w-full text-center font-medium">{item.title}</span>
                {/if}
              </a>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Danger Zone -->
      {#if onDeletePerson}
        <div class="border border-red-200 bg-red-50/60 rounded-xl p-3 space-y-2">
          <div>
            <span class="text-xs font-semibold text-red-900 block">Danger Zone</span>
            <span class="text-[11px] text-red-700/80">You will see exactly what is removed before anything is deleted.</span>
          </div>
          <button
            type="button"
            onclick={() => onDeletePerson(person)}
            class="w-full inline-flex items-center justify-center space-x-1 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:text-red-800 bg-white hover:bg-red-100 border border-red-300 rounded-lg transition-colors cursor-pointer"
          >
            <Trash2 class="w-3.5 h-3.5" />
            <span>Delete person…</span>
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}
