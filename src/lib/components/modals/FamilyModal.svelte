<script lang="ts">
  import { Users, RefreshCw } from 'lucide-svelte';
  import BaseModal from './BaseModal.svelte';
  import type { FamilyFormData, OpenAddFamilyDefaults } from '$lib/types/genealogy';

  interface Props {
    show: boolean;
    individuals: any[];
    families: any[];
    defaults?: OpenAddFamilyDefaults;
    isSubmitting?: boolean;
    error?: string | null;
    onclose: () => void;
    onsubmit: (data: FamilyFormData, isEditing: boolean, editingFamilyId: string | null) => void;
    onopenAddPerson: () => void;
  }

  let {
    show,
    individuals = [],
    families = [],
    defaults,
    isSubmitting = false,
    error = null,
    onclose,
    onsubmit,
    onopenAddPerson
  }: Props = $props();

  let familyModalMode = $state<'editFamily' | 'newFamily' | 'addChild'>('newFamily');
  let isEditingFamily = $state(false);
  let editingFamilyId = $state<string | null>(null);
  let familyHusbandId = $state<string>('');
  let familyWifeId = $state<string>('');
  let familyChildIds = $state<string[]>([]);
  let familyMarriageDate = $state('');
  let familyMarriagePlace = $state('');
  let familyDivorceDate = $state('');
  let familyDivorcePlace = $state('');
  let familyAnchorPersonId = $state<string | null>(null);
  let localError = $state<string | null>(null);

  $effect(() => {
    if (show) {
      localError = null;
      familyModalMode = defaults?.mode || (defaults?.familyId ? 'editFamily' : 'newFamily');

      const defaultP1 = defaults?.partner1Id || defaults?.husbandId;
      const defaultP2 = defaults?.partner2Id || defaults?.wifeId;

      familyAnchorPersonId = defaultP1 || defaultP2 || null;

      if (familyModalMode === 'addChild') {
        const anchorId = defaultP1 || defaultP2;
        let existingFamily: any = null;
        if (anchorId && families.length > 0) {
          const famsForPerson = families.filter(
            (f: any) =>
              (f.partner1Id || f.husbandId) === anchorId ||
              (f.partner2Id || f.wifeId) === anchorId
          );
          existingFamily =
            famsForPerson.find((f: any) => (f.partner1Id || f.husbandId) && (f.partner2Id || f.wifeId)) ||
            famsForPerson[0] ||
            null;
        }

        if (existingFamily) {
          isEditingFamily = true;
          editingFamilyId = existingFamily.id;
          familyHusbandId = existingFamily.partner1Id || existingFamily.husbandId || '';
          familyWifeId = existingFamily.partner2Id || existingFamily.wifeId || '';
          const existingChildIds = (existingFamily.children || []).map((c: any) => c.childId || c);
          familyChildIds = defaults?.childId && !existingChildIds.includes(defaults.childId)
            ? [...existingChildIds, defaults.childId]
            : existingChildIds;

          const marrEvent = (existingFamily.events || []).find((e: any) => e.type === 'MARR');
          familyMarriageDate = marrEvent?.dateRaw || '';
          familyMarriagePlace = marrEvent?.place || '';
          const divEvent = (existingFamily.events || []).find((e: any) => e.type === 'DIV');
          familyDivorceDate = divEvent?.dateRaw || '';
          familyDivorcePlace = divEvent?.place || '';
        } else {
          isEditingFamily = false;
          editingFamilyId = null;
          familyHusbandId = defaultP1 || '';
          familyWifeId = defaultP2 || '';
          familyChildIds = defaults?.childId ? [defaults.childId] : [];
          familyMarriageDate = '';
          familyMarriagePlace = '';
          familyDivorceDate = '';
          familyDivorcePlace = '';
        }
      } else if (defaults?.familyId && families.length > 0) {
        const targetFamily = families.find((f: any) => f.id === defaults.familyId);
        if (targetFamily) {
          isEditingFamily = true;
          editingFamilyId = targetFamily.id;
          familyHusbandId = targetFamily.partner1Id || targetFamily.husbandId || '';
          familyWifeId = targetFamily.partner2Id || targetFamily.wifeId || '';
          familyChildIds = (targetFamily.children || []).map((c: any) => c.childId || c);

          const marrEvent = (targetFamily.events || []).find((e: any) => e.type === 'MARR');
          familyMarriageDate = marrEvent?.dateRaw || '';
          familyMarriagePlace = marrEvent?.place || '';
          const divEvent = (targetFamily.events || []).find((e: any) => e.type === 'DIV');
          familyDivorceDate = divEvent?.dateRaw || '';
          familyDivorcePlace = divEvent?.place || '';
        }
      } else if (familyModalMode === 'newFamily') {
        isEditingFamily = false;
        editingFamilyId = null;
        familyHusbandId = defaultP1 || '';
        familyWifeId = defaultP2 || '';
        familyChildIds = defaults?.childId ? [defaults.childId] : [];
        familyMarriageDate = '';
        familyMarriagePlace = '';
        familyDivorceDate = '';
        familyDivorcePlace = '';
      } else {
        let targetFamily: any = null;
        if (defaultP1 && families.length > 0) {
          targetFamily = families.find(
            (f: any) => (f.partner1Id || f.husbandId) === defaultP1
          );
        } else if (defaultP2 && families.length > 0) {
          targetFamily = families.find(
            (f: any) => (f.partner2Id || f.wifeId) === defaultP2
          );
        }

        if (targetFamily) {
          isEditingFamily = true;
          editingFamilyId = targetFamily.id;
          familyHusbandId = targetFamily.partner1Id || targetFamily.husbandId || '';
          familyWifeId = targetFamily.partner2Id || targetFamily.wifeId || '';
          familyChildIds = (targetFamily.children || []).map((c: any) => c.childId || c);

          const marrEvent = (targetFamily.events || []).find((e: any) => e.type === 'MARR');
          familyMarriageDate = marrEvent?.dateRaw || '';
          familyMarriagePlace = marrEvent?.place || '';
          const divEvent = (targetFamily.events || []).find((e: any) => e.type === 'DIV');
          familyDivorceDate = divEvent?.dateRaw || '';
          familyDivorcePlace = divEvent?.place || '';
        } else {
          isEditingFamily = false;
          editingFamilyId = null;
          familyHusbandId = defaultP1 || '';
          familyWifeId = defaultP2 || '';
          familyChildIds = defaults?.childId ? [defaults.childId] : [];
          familyMarriageDate = '';
          familyMarriagePlace = '';
          familyDivorceDate = '';
          familyDivorcePlace = '';
        }
      }
    }
  });

  function toggleFamilyChild(id: string) {
    if (familyChildIds.includes(id)) {
      familyChildIds = familyChildIds.filter((cid) => cid !== id);
    } else {
      familyChildIds = [...familyChildIds, id];
    }
  }

  function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!familyHusbandId && !familyWifeId && familyChildIds.length === 0) {
      localError = 'Please select at least one parent or child to form a family.';
      return;
    }
    localError = null;

    onsubmit(
      {
        partner1Id: familyHusbandId || undefined,
        partner2Id: familyWifeId || undefined,
        husbandId: familyHusbandId || undefined,
        wifeId: familyWifeId || undefined,
        childrenIds: familyChildIds,
        marriageDate: familyMarriageDate.trim() || undefined,
        marriagePlace: familyMarriagePlace.trim() || undefined,
        divorceDate: familyDivorceDate.trim() || undefined,
        divorcePlace: familyDivorcePlace.trim() || undefined
      },
      isEditingFamily,
      editingFamilyId
    );
  }

  let modalTitle = $derived(
    familyModalMode === 'addChild'
      ? 'Add Children to Family'
      : isEditingFamily
        ? 'Edit Family Union'
        : 'Add Family Union'
  );

  let modalSubtitle = $derived(
    familyModalMode === 'addChild'
      ? 'Choose the co-parent partner or leave as "None / Single Parent".'
      : null
  );
</script>

<BaseModal
  {show}
  title={modalTitle}
  subtitle={modalSubtitle}
  icon={Users}
  iconBgClass="bg-amber-100"
  iconBorderClass="border-amber-300"
  iconTextClass="text-amber-800"
  maxWidthClass="max-w-lg"
  error={error || localError}
  {onclose}
>
  <form onsubmit={handleSubmit} class="space-y-4">
    <div class="space-y-4">
      {#if familyModalMode === 'addChild' && familyAnchorPersonId}
        {@const anchorInd = individuals.find((i: any) => i.id === familyAnchorPersonId)}
        {@const anchorName = anchorInd ? [anchorInd.givenName, anchorInd.surname].filter(Boolean).join(' ') || anchorInd.id : 'Selected Parent'}
        <div class="bg-amber-100/60 border border-amber-300/80 rounded-xl p-3 text-xs text-amber-900 space-y-1">
          <span class="font-bold block">Adding child for: {anchorName}</span>
          <p class="text-stone-600 text-[11px]">
            You can select a partner below to associate the child with both parents, or leave the partner as <em>None / Unknown</em> for a single-parent family.
          </p>
        </div>
      {/if}

      <!-- Spouses / Partners -->
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label for="family-husband" class="text-xs font-semibold text-stone-700 block mb-1">Partner 1</label>
          <select
            id="family-husband"
            bind:value={familyHusbandId}
            disabled={isSubmitting}
            class="w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-2 text-xs text-stone-900 focus:outline-none focus:border-amber-600 focus:ring-1 focus:ring-amber-600 disabled:opacity-50"
          >
            <option value="">None / Unknown</option>
            {#each individuals as ind}
              <option value={ind.id}>
                {[ind.givenName, ind.surname].filter(Boolean).join(' ') || ind.id} ({ind.sex || '?'})
              </option>
            {/each}
          </select>
        </div>
        <div>
          <label for="family-wife" class="text-xs font-semibold text-stone-700 block mb-1">Partner 2</label>
          <select
            id="family-wife"
            bind:value={familyWifeId}
            disabled={isSubmitting}
            class="w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-2 text-xs text-stone-900 focus:outline-none focus:border-amber-600 focus:ring-1 focus:ring-amber-600 disabled:opacity-50"
          >
            <option value="">None / Unknown</option>
            {#each individuals as ind}
              <option value={ind.id}>
                {[ind.givenName, ind.surname].filter(Boolean).join(' ') || ind.id} ({ind.sex || '?'})
              </option>
            {/each}
          </select>
        </div>
      </div>

      <!-- Marriage Event -->
      <div class="border-t border-stone-200 pt-3">
        <h4 class="text-xs font-bold uppercase tracking-wider text-stone-600 mb-2">Marriage / Union Event</h4>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label for="marriage-date" class="text-xs font-medium text-stone-600 block mb-1">Marriage Date</label>
            <input
              id="marriage-date"
              type="text"
              bind:value={familyMarriageDate}
              placeholder="e.g. 12 JUN 1940"
              disabled={isSubmitting}
              class="w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-1.5 text-xs text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-amber-600 focus:ring-1 focus:ring-amber-600 disabled:opacity-50"
            />
          </div>
          <div>
            <label for="marriage-place" class="text-xs font-medium text-stone-600 block mb-1">Marriage Place</label>
            <input
              id="marriage-place"
              type="text"
              bind:value={familyMarriagePlace}
              placeholder="e.g. Edinburgh, Scotland"
              disabled={isSubmitting}
              class="w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-1.5 text-xs text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-amber-600 focus:ring-1 focus:ring-amber-600 disabled:opacity-50"
            />
          </div>
        </div>
      </div>

      <!-- Divorce / Separation Event -->
      {#if isEditingFamily}
        <div class="border-t border-stone-200 pt-3">
          <h4 class="text-xs font-bold uppercase tracking-wider text-stone-600 mb-2">Divorce / Separation</h4>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label for="divorce-date" class="text-xs font-medium text-stone-600 block mb-1">Divorce Date</label>
              <input
                id="divorce-date"
                type="text"
                bind:value={familyDivorceDate}
                placeholder="e.g. 3 SEP 1985 (leave blank if none)"
                disabled={isSubmitting}
                class="w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-1.5 text-xs text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-amber-600 focus:ring-1 focus:ring-amber-600 disabled:opacity-50"
              />
            </div>
            <div>
              <label for="divorce-place" class="text-xs font-medium text-stone-600 block mb-1">Place</label>
              <input
                id="divorce-place"
                type="text"
                bind:value={familyDivorcePlace}
                placeholder="e.g. Adelaide, Australia"
                disabled={isSubmitting}
                class="w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-1.5 text-xs text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-amber-600 focus:ring-1 focus:ring-amber-600 disabled:opacity-50"
              />
            </div>
          </div>
          <p class="text-[11px] text-stone-500 mt-1.5">Clearing both fields removes the divorce record. For remarriage, use "New Marriage / Partner" in a person's drawer to create a second union.</p>
        </div>
      {/if}

      <!-- Children Selection -->
      <div class="border-t border-stone-200 pt-3">
        <div class="flex items-center justify-between mb-2">
          <h4 class="text-xs font-bold uppercase tracking-wider text-stone-600">
            Link Children ({familyChildIds.length} selected)
          </h4>
          <button
            type="button"
            onclick={() => {
              onclose();
              onopenAddPerson();
            }}
            class="text-[11px] font-medium text-emerald-800 hover:text-emerald-950 underline cursor-pointer"
          >
            + New Individual
          </button>
        </div>
        <div class="max-h-40 overflow-y-auto space-y-1.5 border border-stone-200 rounded-lg p-2.5 bg-stone-50/70">
          {#if individuals.length === 0}
            <p class="text-xs text-stone-500 italic">No individuals available in this tree</p>
          {:else}
            {#each individuals as ind}
              {#if ind.id !== familyHusbandId && ind.id !== familyWifeId}
                <label class="flex items-center space-x-2 text-xs text-stone-700 hover:bg-stone-200/50 p-1.5 rounded-md cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    checked={familyChildIds.includes(ind.id)}
                    onchange={() => toggleFamilyChild(ind.id)}
                    disabled={isSubmitting}
                    class="text-amber-800 rounded-sm focus:ring-amber-600"
                  />
                  <span class="font-medium">{[ind.givenName, ind.surname].filter(Boolean).join(' ') || ind.id}</span>
                  <span class="text-stone-400 text-[10px]">({ind.sex || '?'})</span>
                </label>
              {/if}
            {/each}
          {/if}
        </div>
      </div>
    </div>

    <div class="flex justify-end space-x-2 pt-3 border-t border-stone-200">
      <button
        type="button"
        onclick={onclose}
        disabled={isSubmitting}
        class="px-4 py-2 text-xs font-medium text-stone-600 hover:text-stone-900 rounded-lg hover:bg-stone-200/60 transition-colors cursor-pointer disabled:opacity-50"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={isSubmitting}
        class="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold bg-amber-800 hover:bg-amber-700 text-amber-50 rounded-lg transition-colors cursor-pointer shadow-xs disabled:opacity-50"
      >
        {#if isSubmitting}
          <RefreshCw class="w-3.5 h-3.5 animate-spin mr-1" />
          <span>Saving...</span>
        {:else}
          <span>{isEditingFamily ? 'Update Family' : 'Create Family'}</span>
        {/if}
      </button>
    </div>
  </form>
</BaseModal>
