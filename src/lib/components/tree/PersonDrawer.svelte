<script lang="ts">
  import { X, MapPin, FileText, Upload, Image as ImageIcon, UserPlus, Pencil, Trash2, Cross, ExternalLink } from 'lucide-svelte';
  import type { RelativeAction } from './tree-editor.svelte.js';
  import type { ParentChildType, RelationshipKind } from '#lib/types/genealogy.js';
  import type { PersonSummaryDto } from '#lib/server/services/person-page-service.js';
  import { sexLabel } from '#lib/shared/sex.js';
  import type { PersonPageDto } from '#lib/server/services/person-page-service.js';

  interface Props {
    /** The person's page data; null while it loads. */
    page: PersonPageDto | null;
    treeId: string;
    /** Set when the page data could not be loaded. */
    error?: string | null;
    onClose: () => void;
    onMediaUploaded?: () => void;
    onSelectPerson?: (id: string) => void;
    /** Open the add-relationship dialog, optionally on a form and a partnership. */
    onAddRelationship?: (personId: string, options?: { kind?: RelationshipKind; unionId?: string }) => void;
    /** A relative's trash button was pressed; the caller asks what happened to them. */
    onRemoveRelative?: (action: RelativeAction) => void;
    onEditPerson?: (personId: string) => void;
    /** Ask to delete the person; the caller previews exactly what goes and confirms. */
    onDeletePerson?: (personId: string) => void;
    /** Open the death form for this person. */
    onRecordDeath?: (personId: string) => void;
    /** Open the partnership editor. */
    onEditUnion?: (unionId: string) => void;
    /** Open the merge dialog for a partnership that has a twin between the same people. */
    onMergeUnion?: (unionId: string) => void;
  }

  let {
    page,
    treeId,
    error = null,
    onClose,
    onMediaUploaded,
    onSelectPerson,
    onAddRelationship,
    onRemoveRelative,
    onEditPerson,
    onDeletePerson,
    onRecordDeath,
    onEditUnion,
    onMergeUnion
  }: Props = $props();

  const person = $derived(page?.person ?? null);
  const hasSteps = $derived((page?.stepParents.length ?? 0) > 0 || (page?.stepChildren.length ?? 0) > 0);
  const personHref = $derived(person ? `/trees/${encodeURIComponent(treeId)}/people/${encodeURIComponent(person.id)}` : '#');

  /** What the trash button on a relative's entry hands to the caller. */
  function removal(
    relation: RelativeAction['relation'],
    relative: PersonSummaryDto,
    extra: { unionId?: string; type?: ParentChildType } = {}
  ): RelativeAction | undefined {
    if (!onRemoveRelative || !person) return undefined;
    return {
      relation,
      owner: { id: person.id, givenName: person.displayName, surname: null },
      relative: { id: relative.id, givenName: relative.displayName, surname: null, isDeceased: relative.isDeceased },
      unionId: extra.unionId ?? null,
      type: extra.type ?? null
    };
  }

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

{#snippet personButton(id: string, name: string, note: string, remove?: RelativeAction)}
  <div class="flex items-stretch gap-1">
    <button
      type="button"
      onclick={() => onSelectPerson?.(id)}
      class="min-w-0 flex-1 text-left flex items-center justify-between bg-white rounded-lg px-2.5 py-1.5 border border-stone-200 hover:border-emerald-500 transition-colors cursor-pointer group"
    >
      <span class="text-xs font-medium text-stone-800 group-hover:text-emerald-800">
        {name}
        {#if note}<span class="text-stone-600 font-normal">({note})</span>{/if}
      </span>
    </button>
    {#if remove && onRemoveRelative}
      <button
        type="button"
        onclick={() => onRemoveRelative(remove)}
        title="Remove, or record what happened"
        aria-label={`Remove ${name}, or record what happened`}
        class="shrink-0 rounded-lg border border-stone-200 bg-white px-2 text-stone-400 hover:border-red-300 hover:bg-red-50 hover:text-red-700 transition-colors cursor-pointer"
      >
        <Trash2 class="w-3.5 h-3.5" />
      </button>
    {/if}
  </div>
{/snippet}

{#snippet addLink(label: string, kind: RelationshipKind, unionId?: string)}
  {#if onAddRelationship && person}
    <button
      type="button"
      onclick={() => onAddRelationship(person.id, { kind, unionId })}
      class="text-left text-[11px] font-semibold text-emerald-800 hover:text-emerald-950 hover:underline cursor-pointer"
    >
      + {label}
    </button>
  {/if}
{/snippet}

{#if page && person}
  <div class="fixed inset-y-0 right-0 z-50 w-full sm:w-96 bg-[#fcfaf5]/98 backdrop-blur-xl border-l border-stone-300 shadow-2xl flex flex-col transition-transform duration-300">
    <!-- Header -->
    <div class="p-6 border-b border-stone-200/90 flex items-start justify-between bg-[#fbf8f0]">
      <div>
        <h2 class="text-xl font-bold text-stone-900">{person.displayName}</h2>
        <p class="text-xs text-stone-500 mt-0.5">
          <a href={personHref} class="inline-flex items-center gap-1 font-semibold text-emerald-800 hover:underline">
            <ExternalLink class="w-3 h-3" />
            <span>Open full page</span>
          </a>
        </p>
      </div>
      <div class="flex items-center space-x-1">
        {#if onRecordDeath}
          <button
            type="button"
            onclick={() => onRecordDeath(person.id)}
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
            onclick={() => onEditPerson(person.id)}
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
        <div class="w-16 h-16 rounded-full bg-emerald-50 border-2 border-emerald-300 flex items-center justify-center text-emerald-800 shadow-xs">
          <span class="text-xl font-bold uppercase">{person.displayName.slice(0, 2) || 'UN'}</span>
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-semibold text-stone-800">Sex: <span class="font-normal text-stone-600">{sexLabel(person.sex)}</span></p>
          {#if page.vitals.lifespan}
            <p class="text-xs text-stone-500 mt-1">{page.vitals.lifespan}</p>
          {/if}
        </div>
        {#if onAddRelationship}
          <button
            type="button"
            onclick={() => onAddRelationship(person.id)}
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

        {#each page.parentFamilies as family (family.unionId ?? 'direct')}
          <div class="bg-stone-50/90 rounded-xl p-3 border border-stone-200 shadow-xs space-y-2" data-testid="parents">
            <span class="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">
              {family.parents.length > 1 ? 'Parents' : 'Parent'}
            </span>
            {#each family.parents as parent (parent.person.id + parent.type)}
              {@render personButton(parent.person.id, parent.person.displayName, parent.type, removal('parent', parent.person, { type: parent.type }))}
            {/each}
            {@render addLink('Add parent', 'add_parent', family.unionId ?? undefined)}
          </div>
        {:else}
          <div class="bg-stone-50/90 rounded-xl p-3 border border-stone-200 shadow-xs space-y-1" data-testid="parents">
            <span class="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">Parents</span>
            <p class="text-xs text-stone-500 italic">None recorded</p>
            {@render addLink('Add parent', 'add_parent')}
          </div>
        {/each}

        {#each page.partnerships as union (union.unionId)}
          <div class="bg-amber-50/70 rounded-xl p-3 border border-amber-200/80 shadow-xs space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-[11px] font-semibold text-amber-800 uppercase tracking-wide">
                {union.label?.full ?? (union.partners.length > 0 ? 'Partner & Children' : 'Children, other parent not recorded')}
                {#if union.status !== 'active'}<span class="text-red-700">· {union.status}</span>{/if}
                {#if union.isWidowed}<span class="text-stone-700">· widowed</span>{/if}
              </span>
              <span class="flex items-center gap-2">
                <a href={`/trees/${encodeURIComponent(treeId)}/unions/${encodeURIComponent(union.unionId)}`} class="text-[11px] font-semibold text-emerald-800 hover:underline">Open</a>
                {#if onEditUnion}
                  <button type="button" onclick={() => onEditUnion(union.unionId)} class="text-[11px] font-semibold text-emerald-800 hover:underline cursor-pointer">Dates &amp; status</button>
                {/if}
                {#if onMergeUnion && union.isMergeable}
                  <button type="button" onclick={() => onMergeUnion(union.unionId)} class="text-[11px] font-semibold text-emerald-800 hover:underline cursor-pointer">Merge…</button>
                {/if}
              </span>
            </div>
            {#each union.partners as partner (partner.id)}
              {@render personButton(partner.id, partner.displayName, partner.isDeceased ? 'deceased' : 'partner', removal('partner', partner, { unionId: union.unionId }))}
            {/each}
            {#if union.partners.length === 0}{@render addLink('Add partner', 'add_partner', union.unionId)}{/if}
            {#if union.children.length}
              <div class="space-y-1 pt-0.5">
                <span class="text-[10px] font-semibold text-stone-500 uppercase tracking-wide">Children</span>
                {#each union.children as child (child.person.id)}
                  {@render personButton(child.person.id, child.person.displayName, '', removal('child', child.person, { type: child.types[0] }))}
                {/each}
              </div>
            {/if}
            {@render addLink('Add child', 'add_child', union.unionId)}
          </div>
        {/each}

        {#if page.directChildren.length > 0}
          <div class="bg-stone-50/90 rounded-xl p-3 border border-stone-200 shadow-xs space-y-1">
            <span class="text-[10px] font-semibold text-stone-500 uppercase tracking-wide">Children (no partnership recorded)</span>
            {#each page.directChildren as child (child.person.id)}
              {@render personButton(child.person.id, child.person.displayName, '', removal('child', child.person, { type: child.types[0] }))}
            {/each}
          </div>
        {/if}

        {#if page.parentFamilies.length > 0 || page.siblings.full.length > 0 || page.siblings.half.length > 0}
          <div class="bg-stone-50/90 rounded-xl p-3 border border-stone-200 shadow-xs space-y-1" data-testid="siblings">
            <span class="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">Siblings</span>
            {#each page.siblings.full as sibling (sibling.id)}
              {@render personButton(sibling.id, sibling.displayName, '', removal('sibling', sibling))}
            {/each}
            {#each page.siblings.half as sibling (sibling.id)}
              {@render personButton(sibling.id, sibling.displayName, 'half-sibling', removal('sibling', sibling))}
            {/each}
            {@render addLink('Add sibling', 'add_sibling')}
          </div>
        {/if}

        {#if hasSteps}
          <div class="bg-stone-50/90 rounded-xl p-3 border border-stone-200 shadow-xs space-y-2" data-testid="step-relatives">
            <span class="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">Step relatives</span>
            {#each page.stepParents as step (step.person.id)}
              {@render personButton(step.person.id, step.person.displayName, 'step-parent')}
            {/each}
            {#each page.stepChildren as step (step.person.id)}
              {@render personButton(step.person.id, step.person.displayName, `step-child, via ${step.via.displayName}`)}
            {/each}
          </div>
        {/if}

        <!-- Add-relationship action -->
        <div class="bg-stone-100/70 border border-stone-200 rounded-xl p-3 space-y-2">
          <button
            type="button"
            onclick={() => onAddRelationship?.(person.id)}
            class="w-full text-left text-xs font-medium text-emerald-800 hover:text-emerald-950 hover:bg-white rounded-lg px-2 py-1.5 transition-colors cursor-pointer"
          >
            + Add a parent, partner, child or sibling
          </button>
        </div>
      </div>

      <!-- Facts -->
      <div class="space-y-3">
        <h3 class="text-xs font-bold uppercase tracking-wider text-stone-600">Life Events</h3>
        {#if page.facts.length === 0}
          <p class="text-xs text-stone-500 italic">No events recorded</p>
        {:else}
          <div class="space-y-2">
            {#each page.facts as fact (fact.id)}
              <div class="bg-stone-50/90 rounded-xl p-3 border shadow-xs {fact.conflict ? 'border-amber-400' : 'border-stone-200'}">
                <div class="flex items-center justify-between text-xs font-semibold text-emerald-800">
                  <span>{fact.label}</span>
                  <span class="text-stone-500 font-normal">{fact.dateText || 'Date unknown'}</span>
                </div>
                {#if fact.value}<p class="text-xs text-stone-800 mt-1">{fact.value}</p>{/if}
                {#if fact.place}
                  <div class="flex items-center text-xs text-stone-600 mt-1.5">
                    <MapPin class="w-3.5 h-3.5 mr-1 text-stone-400 shrink-0" />
                    <span>{fact.place}</span>
                  </div>
                {/if}
                {#if fact.notes}
                  <p class="text-xs text-stone-700 mt-1">{fact.notes}</p>
                {/if}
                {#if fact.conflict}
                  <p class="text-[11px] text-amber-800 mt-1">{fact.conflict.kind === 'repeat' ? 'Recorded twice with the same details.' : 'Disagrees with another recorded ' + fact.label.toLowerCase() + '.'}</p>
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

        {#if page.media.length === 0}
          <div class="border border-dashed border-stone-300 rounded-xl p-4 text-center text-xs text-stone-500 bg-stone-50/50">
            <ImageIcon class="w-6 h-6 mx-auto mb-1 text-stone-400" />
            No photos or historical documents attached
          </div>
        {:else}
          <div class="grid grid-cols-2 gap-2">
            {#each page.media as item (item.id)}
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
            onclick={() => onDeletePerson(person.id)}
            class="w-full inline-flex items-center justify-center space-x-1 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:text-red-800 bg-white hover:bg-red-100 border border-red-300 rounded-lg transition-colors cursor-pointer"
          >
            <Trash2 class="w-3.5 h-3.5" />
            <span>Delete person…</span>
          </button>
        </div>
      {/if}
    </div>
  </div>
{:else if error}
  <div class="fixed inset-y-0 right-0 z-50 w-full sm:w-96 bg-[#fcfaf5] border-l border-stone-300 shadow-2xl p-6" role="alert">
    <button type="button" onclick={onClose} aria-label="Close details" class="float-right text-stone-400 hover:text-stone-800"><X class="w-5 h-5" /></button>
    <p class="text-sm text-red-800">{error}</p>
  </div>
{/if}
