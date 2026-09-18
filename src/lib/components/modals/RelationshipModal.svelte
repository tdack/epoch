<script lang="ts">
  import { UserPlus, Baby, Heart, Search, Sparkles } from 'lucide-svelte';
  import BaseModal from './BaseModal.svelte';
  import { searchPeopleApi, applyRelationshipApi } from '#lib/services/tree-api.js';
  import type {
    RelationshipIntent,
    ParentChildType,
    ParentRole,
    PeopleSearchResult,
    RelationshipPlanWarning
  } from '#lib/types/genealogy.js';

  interface Props {
    show: boolean;
    treeId: string;
    /** The person who is the anchor/subject of this relationship edit. */
    anchor: { id: string; givenName: string | null; surname: string | null };
    /** Optional counterpart already known (e.g. from drag-to-relate). */
    preselect?: { id: string; givenName: string | null; surname: string | null } | null;
    onclose: () => void;
    onsaved: () => void;
  }

  let { show, treeId, anchor, preselect = null, onclose, onsaved }: Props = $props();

  type IntentKind = 'add_parent' | 'add_child' | 'add_partner';

  let kind = $state<IntentKind>('add_parent');
  let role = $state<ParentRole>('parent');
  let type = $state<ParentChildType>('biological');
  let searchQuery = $state('');
  let results = $state<PeopleSearchResult[]>([]);
  let selected = $state<PeopleSearchResult | null>(null);
  let newGivenName = $state('');
  let newSurname = $state('');
  let useNewPerson = $state(false);
  let sentence = $state('');
  let warnings = $state<RelationshipPlanWarning[]>([]);
  let isSearching = $state(false);
  let isSubmitting = $state(false);
  let error = $state<string | null>(null);
  let submitted = $state(false);

  const typeOptions: Array<{ value: ParentChildType; label: string }> = [
    { value: 'biological', label: 'Biological' },
    { value: 'adoptive', label: 'Adoptive' },
    { value: 'foster', label: 'Foster' },
    { value: 'guardian', label: 'Guardian' },
    { value: 'unknown', label: 'Unknown / other' }
  ];

  const roleOptions: Array<{ value: ParentRole; label: string }> = [
    { value: 'parent', label: 'Parent' },
    { value: 'mother', label: 'Mother' },
    { value: 'father', label: 'Father' }
  ];

  function reset() {
    kind = 'add_parent';
    role = 'parent';
    type = 'biological';
    searchQuery = '';
    results = [];
    selected = preselect
      ? { id: preselect.id, givenName: preselect.givenName ?? null, surname: preselect.surname ?? null }
      : null;
    newGivenName = '';
    newSurname = '';
    useNewPerson = false;
    sentence = '';
    warnings = [];
    error = null;
    submitted = false;
  }

  $effect(() => {
    if (show) reset();
  });

  async function runSearch() {
    if (!searchQuery.trim()) {
      results = [];
      return;
    }
    isSearching = true;
    try {
      results = await searchPeopleApi(treeId, searchQuery);
    } catch (e: any) {
      error = e.message;
    } finally {
      isSearching = false;
    }
  }

  function buildIntent(): RelationshipIntent | null {
    if (kind === 'add_partner') {
      if (useNewPerson) {
        return {
          kind: 'add_partner',
          person: anchor,
          partner: { id: `new:${newGivenName}:${newSurname}`, givenName: newGivenName || null, surname: newSurname || null },
          unionLabel: null
        };
      }
      if (!selected) return null;
      return {
        kind: 'add_partner',
        person: anchor,
        partner: { id: selected.id, givenName: selected.givenName, surname: selected.surname },
        unionLabel: null
      };
    }

    // add_parent / add_child
    if (useNewPerson) {
      const other: { id: string; givenName: string | null; surname: string | null } = {
        id: `new:${newGivenName}:${newSurname}`,
        givenName: newGivenName || null,
        surname: newSurname || null
      };
      if (kind === 'add_parent') {
        return { kind, child: anchor, parent: other, type, role, unionLabel: null };
      }
      return { kind, parent: anchor, child: other, type, unionLabel: null };
    }

    if (!selected) return null;
    const other = { id: selected.id, givenName: selected.givenName, surname: selected.surname };
    if (kind === 'add_parent') {
      return { kind, child: anchor, parent: other, type, role, unionLabel: null };
    }
    return { kind, parent: anchor, child: other, type, unionLabel: null };
  }

  function previewSentence() {
    const intent = buildIntent();
    if (!intent) return '';
    const aName = [anchor.givenName, anchor.surname].filter(Boolean).join(' ') || anchor.id;
    if (kind === 'add_partner') {
      const p = useNewPerson
        ? [newGivenName, newSurname].filter(Boolean).join(' ')
        : selected
          ? [selected.givenName, selected.surname].filter(Boolean).join(' ')
          : '';
      return p ? `${p} will be recorded as ${aName}'s partner.` : '';
    }
    if (kind === 'add_parent') {
      const p = useNewPerson
        ? [newGivenName, newSurname].filter(Boolean).join(' ')
        : selected
          ? [selected.givenName, selected.surname].filter(Boolean).join(' ')
          : '';
      return p ? `${p} will be recorded as ${aName}'s ${type} ${role}.` : '';
    }
    const c = useNewPerson
      ? [newGivenName, newSurname].filter(Boolean).join(' ')
      : selected
        ? [selected.givenName, selected.surname].filter(Boolean).join(' ')
        : '';
    return c ? `${c} will be recorded as ${aName}'s ${type} child.` : '';
  }

  async function submit() {
    const intent = buildIntent();
    if (!intent) {
      error = 'Select an existing person or enter a new person.';
      return;
    }
    isSubmitting = true;
    error = null;
    try {
      const plan = await applyRelationshipApi(treeId, intent);
      sentence = plan.sentence;
      warnings = plan.warnings;
      submitted = true;
      onsaved();
    } catch (e: any) {
      error = e.message;
    } finally {
      isSubmitting = false;
    }
  }
</script>

<BaseModal
  {show}
  title="Add relationship"
  subtitle={submitted ? 'Saved' : 'Describe the relationship'}
  icon={Sparkles}
  onclose={onclose}
  {error}
>
  {#if submitted}
    <div class="space-y-3">
      <p class="text-sm text-stone-800 font-medium">{sentence}</p>
      {#if warnings.length > 0}
        <ul class="space-y-1">
          {#each warnings as w}
            <li class="text-xs text-amber-700">{w.message}</li>
          {/each}
        </ul>
      {/if}
      <button type="button" onclick={onclose} class="w-full py-2 rounded-lg bg-emerald-700 text-white font-semibold cursor-pointer">Done</button>
    </div>
  {:else}
    <div class="space-y-4">
      <!-- Intent kind -->
      <div class="grid grid-cols-3 gap-2">
        {#each [
          { v: 'add_parent' as const, label: 'Add parent', icon: UserPlus },
          { v: 'add_child' as const, label: 'Add child', icon: Baby },
          { v: 'add_partner' as const, label: 'Add partner', icon: Heart }
        ] as const as Array<{ v: IntentKind; label: string; icon: typeof UserPlus }> as item}
          <button
            type="button"
            onclick={() => (kind = item.v)}
            class="p-2 rounded-lg border text-xs font-medium flex flex-col items-center gap-1 cursor-pointer {kind === item.v ? 'bg-emerald-100 border-emerald-400 text-emerald-900' : 'bg-white border-stone-300 text-stone-600'}"
          >
            <item.icon class="w-4 h-4" />
            {item.label}
          </button>
        {/each}
      </div>

      {#if kind === 'add_parent'}
        <div class="space-y-2">
          <label class="block text-xs font-semibold text-stone-700" for="rel-type">Relationship type</label>
          <select id="rel-type" aria-label="Relationship type" bind:value={type} class="w-full rounded-lg border border-stone-300 bg-white p-2 text-sm">
            {#each typeOptions as t}
              <option value={t.value}>{t.label}</option>
            {/each}
          </select>
          <label class="block text-xs font-semibold text-stone-700" for="rel-role">Role</label>
          <select id="rel-role" aria-label="Role" bind:value={role} class="w-full rounded-lg border border-stone-300 bg-white p-2 text-sm">
            {#each roleOptions as r}
              <option value={r.value}>{r.label}</option>
            {/each}
          </select>
        </div>
      {/if}

      {#if kind === 'add_child'}
        <div class="space-y-2">
          <label class="block text-xs font-semibold text-stone-700" for="rel-type-child">Relationship type</label>
          <select id="rel-type-child" aria-label="Relationship type" bind:value={type} class="w-full rounded-lg border border-stone-300 bg-white p-2 text-sm">
            {#each typeOptions as t}
              <option value={t.value}>{t.label}</option>
            {/each}
          </select>
        </div>
      {/if}

      <!-- Existing vs new person -->
      <div class="flex items-center gap-2">
        <button
          type="button"
          onclick={() => (useNewPerson = false)}
          class="px-3 py-1.5 rounded-lg text-xs font-medium border cursor-pointer {!useNewPerson ? 'bg-emerald-100 border-emerald-400 text-emerald-900' : 'bg-white border-stone-300 text-stone-600'}"
        >
          Existing person
        </button>
        <button
          type="button"
          onclick={() => (useNewPerson = true)}
          class="px-3 py-1.5 rounded-lg text-xs font-medium border cursor-pointer {useNewPerson ? 'bg-emerald-100 border-emerald-400 text-emerald-900' : 'bg-white border-stone-300 text-stone-600'}"
        >
          New person
        </button>
      </div>

      {#if useNewPerson}
        <div class="space-y-2">
          <label class="block text-xs font-semibold text-stone-700" for="new-given">Given name</label>
          <input id="new-given" type="text" placeholder="Given name" bind:value={newGivenName} class="w-full rounded-lg border border-stone-300 bg-white p-2 text-sm" />
          <label class="block text-xs font-semibold text-stone-700" for="new-surname">Surname</label>
          <input id="new-surname" type="text" placeholder="Surname" bind:value={newSurname} class="w-full rounded-lg border border-stone-300 bg-white p-2 text-sm" />
        </div>
      {:else}
        <div class="space-y-2">
          <label class="block text-xs font-semibold text-stone-700" for="rel-search">Search people by name</label>
          <div class="flex gap-2">
            <input
              id="rel-search"
              type="text"
              placeholder="Search people by name"
              bind:value={searchQuery}
              onkeydown={(e) => { if (e.key === 'Enter') runSearch(); }}
              class="flex-1 rounded-lg border border-stone-300 bg-white p-2 text-sm"
            />
            <button type="button" onclick={runSearch} aria-label="Search" class="p-2 rounded-lg bg-stone-100 border border-stone-300 cursor-pointer">
              <Search class="w-4 h-4 text-stone-600" />
            </button>
          </div>
          {#if isSearching}
            <p class="text-xs text-stone-500">Searching…</p>
          {:else if results.length > 0}
            <ul class="max-h-40 overflow-y-auto space-y-1">
              {#each results as r}
                <li>
                  <button
                    type="button"
                    onclick={() => (selected = r)}
                    class="w-full text-left px-3 py-2 rounded-lg border text-sm cursor-pointer {selected?.id === r.id ? 'bg-emerald-100 border-emerald-400' : 'bg-white border-stone-200'}"
                  >
                    {[r.givenName, r.surname].filter(Boolean).join(' ') || r.id}
                  </button>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="text-xs text-stone-500">No results yet.</p>
          {/if}
        </div>
      {/if}

      <!-- Live preview sentence -->
      {#if previewSentence()}
        <div class="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-900">
          {previewSentence()}
        </div>
      {/if}

      <div class="flex gap-2">
        <button type="button" onclick={onclose} class="flex-1 py-2 rounded-lg bg-stone-200 text-stone-700 font-semibold cursor-pointer">Cancel</button>
        <button
          type="button"
          onclick={submit}
          disabled={isSubmitting}
          class="flex-1 py-2 rounded-lg bg-emerald-700 text-white font-semibold cursor-pointer disabled:opacity-50"
        >
          {isSubmitting ? 'Saving…' : 'Save relationship'}
        </button>
      </div>
    </div>
  {/if}
</BaseModal>
