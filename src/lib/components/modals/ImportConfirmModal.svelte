<script lang="ts">
  import { Upload, RefreshCw } from 'lucide-svelte';
  import BaseModal from './BaseModal.svelte';
  import type { ImportPreviewData, PossibleDuplicateGroup } from '#lib/types/genealogy.js';

  interface Props {
    show: boolean;
    treeName?: string;
    hasSelectedTree: boolean;
    preview: ImportPreviewData | null;
    isLoadingPreview?: boolean;
    isConfirming?: boolean;
    error?: string | null;
    onclose: () => void;
    /** `shouldMergeDuplicateFamilies` is the state of the "merge duplicate families" checkbox. */
    onconfirm: (mode: 'replace' | 'merge', options: { shouldMergeDuplicateFamilies: boolean }) => void;
  }

  let {
    show,
    treeName = 'this tree',
    hasSelectedTree,
    preview,
    isLoadingPreview = false,
    isConfirming = false,
    error = null,
    onclose,
    onconfirm
  }: Props = $props();

  /** On by default: an exact duplicate is the same family written twice, and merging keeps every XREF. */
  let shouldMergeDuplicateFamilies = $state(true);
  // Each opening starts from the default, not from what the last file's review left behind.
  $effect(() => {
    if (show) shouldMergeDuplicateFamilies = true;
  });

  const REASON_TEXT: Record<PossibleDuplicateGroup['reason'], string> = {
    different_facts: 'same partners, but the records state different facts',
    different_child_records: 'same partners, but a child is recorded differently',
    subset_of_full_family: 'one partner only, and its partner and children are already in the fuller family',
    same_single_partner: 'the same single partner, listed more than once'
  };

  /** What to do about each kind of possible duplicate once it is in the tree; not all of them can be merged. */
  const FOLLOW_UP_TEXT: Record<PossibleDuplicateGroup['reason'], string> = {
    different_facts: 'If they are one family, merge them from the partnership menu and choose which fact to keep.',
    different_child_records: 'If they are one family, merge them from the partnership menu and choose which record to keep.',
    subset_of_full_family: 'A different set of partners, so it cannot be merged. If it is a stray copy, delete that partnership; its parent links stay.',
    same_single_partner: 'Only one partner is recorded, so these are not merged automatically. If they are one family, merge them from the partnership menu.'
  };

  /** Families that will exist after the import: the file's count less each exact duplicate that is merged away. */
  const familiesToWrite = $derived.by(() => {
    if (!preview) return 0;
    const mergedAway = shouldMergeDuplicateFamilies
      ? preview.duplicates.exact.reduce((n, group) => n + group.familyIds.length - 1, 0)
      : 0;
    return preview.incoming.families - mergedAway;
  });

  const confirm = (mode: 'replace' | 'merge') => onconfirm(mode, { shouldMergeDuplicateFamilies });
</script>

{#snippet duplicatesBlock()}
  {#if preview && (preview.duplicates.exact.length > 0 || preview.duplicates.possible.length > 0)}
    <div class="bg-amber-50 border border-amber-300 rounded-lg p-3 space-y-2">
      {#if preview.duplicates.exact.length > 0}
        <p class="font-semibold text-amber-950">Duplicate families</p>
        <ul class="list-disc list-inside space-y-0.5 text-stone-800">
          {#each preview.duplicates.exact as group (group.survivorId)}
            <li>
              {group.partners.join(' and ')}: {group.familyIds.length} copies
              <span class="font-mono text-[11px] text-stone-600">({group.familyIds.join(', ')})</span>
            </li>
          {/each}
        </ul>
        <label class="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" class="mt-0.5" bind:checked={shouldMergeDuplicateFamilies} />
          <span>
            Merge duplicate families into one each. Children and facts are combined, and every original XREF is kept as an alias.
          </span>
        </label>
      {/if}
      {#if preview.duplicates.possible.length > 0}
        <p class="font-semibold text-amber-950">Possible duplicates (for review, never merged automatically)</p>
        <ul class="list-disc list-inside space-y-0.5 text-stone-800">
          {#each preview.duplicates.possible as group (group.reason + group.familyIds.join())}
            <li>
              {group.partners.join(' and ')}: {REASON_TEXT[group.reason]}
              <span class="font-mono text-[11px] text-stone-600">({group.familyIds.join(', ')})</span>
              <span class="block pl-4 text-stone-600">{FOLLOW_UP_TEXT[group.reason]}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
{/snippet}

<BaseModal
  {show}
  title="Import GEDCOM"
  icon={Upload}
  iconBgClass="bg-amber-100"
  iconBorderClass="border-amber-300"
  iconTextClass="text-amber-800"
  {error}
  {onclose}
>
  {#if isLoadingPreview}
    <div class="flex items-center space-x-2 text-xs text-stone-600 py-4">
      <RefreshCw class="w-4 h-4 animate-spin" />
      <span>Analysing GEDCOM file against the selected tree...</span>
    </div>
  {:else if preview}
    <div class="text-xs text-stone-700 space-y-3">
      <p>
        File contains <strong>{preview.incoming.individuals}</strong> people,
        <strong>{preview.incoming.families}</strong> families{familiesToWrite !== preview.incoming.families
          ? ` (${familiesToWrite} once duplicates are merged)`
          : ''} and
        <strong>{preview.incoming.events}</strong> events.
      </p>

      {#if !hasSelectedTree}
        <div class="bg-stone-100 border border-stone-300 rounded-lg p-3 space-y-1">
          <p class="font-semibold text-stone-900">New tree</p>
          <p>All {preview.incoming.individuals} people and {familiesToWrite} families from the file will be imported into a fresh tree.</p>
        </div>
        {@render duplicatesBlock()}
        <div class="flex space-x-2 pt-2 border-t border-stone-200">
          <button
            type="button"
            onclick={onclose}
            disabled={isConfirming}
            class="px-4 py-2 text-xs font-medium text-stone-600 hover:text-stone-900 rounded-lg hover:bg-stone-200/60 transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onclick={() => confirm('replace')}
            disabled={isConfirming}
            class="flex-1 inline-flex items-center justify-center space-x-1.5 px-4 py-2 text-xs font-semibold bg-emerald-800 hover:bg-emerald-700 text-amber-50 rounded-lg transition-colors cursor-pointer shadow-xs disabled:opacity-50"
          >
            {#if isConfirming}
              <RefreshCw class="w-3.5 h-3.5 animate-spin mr-1" />
              <span>Importing...</span>
            {:else}
              <span>Import into new tree</span>
            {/if}
          </button>
        </div>
      {:else if preview.mode === 'replace' && preview.deleteCounts}
        <div class="bg-red-50 border border-red-300 rounded-lg p-3 space-y-1">
          <p class="font-semibold text-red-900">Replace — destructive</p>
          <p>
            <strong>{preview.deleteCounts.individuals}</strong> people,
            <strong>{preview.deleteCounts.families}</strong> families and
            <strong>{preview.deleteCounts.events}</strong> events in
            “{treeName}” will be <strong>permanently deleted</strong>
            and replaced by {preview.incoming.individuals} people and
            {familiesToWrite} families from the file.
          </p>
        </div>
        {@render duplicatesBlock()}
        <div class="flex space-x-2 pt-2 border-t border-stone-200">
          <button
            type="button"
            onclick={onclose}
            disabled={isConfirming}
            class="px-4 py-2 text-xs font-medium text-stone-600 hover:text-stone-900 rounded-lg hover:bg-stone-200/60 transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onclick={() => confirm('merge')}
            disabled={isConfirming}
            class="flex-1 px-4 py-2 text-xs font-semibold text-stone-700 border border-stone-300 hover:bg-stone-200/60 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
          >
            Merge instead
          </button>
          <button
            type="button"
            onclick={() => confirm('replace')}
            disabled={isConfirming}
            class="flex-1 inline-flex items-center justify-center space-x-1.5 px-4 py-2 text-xs font-semibold bg-red-800 hover:bg-red-700 text-red-50 rounded-lg transition-colors cursor-pointer shadow-xs disabled:opacity-50"
          >
            {#if isConfirming}
              <RefreshCw class="w-3.5 h-3.5 animate-spin mr-1" />
              <span>Replacing...</span>
            {:else}
              <span>Delete &amp; replace</span>
            {/if}
          </button>
        </div>
      {:else if preview.merge}
        <div class="bg-emerald-50 border border-emerald-300 rounded-lg p-3 space-y-1.5">
          <p class="font-semibold text-emerald-900">Merge — changes preview</p>
          <ul class="space-y-0.5 list-disc list-inside text-stone-800">
            <li>{preview.merge.newIndividuals} new people ({preview.merge.existingIndividuals} already exist and will be kept)</li>
            <li>{preview.merge.newFamilies} new families (fewer if duplicates within the file are merged); {preview.merge.mergedFamilies} will be merged into existing ones</li>
            <li>{preview.merge.newChildLinks} new child links ({preview.merge.duplicateChildLinks} duplicates skipped)</li>
            <li>{preview.merge.newEvents} new events ({preview.merge.duplicateEvents} duplicates skipped)</li>
          </ul>
          {#if preview.deleteCounts}
            <p class="text-stone-600">
              Alternatively, replace would delete {preview.deleteCounts.individuals} people,
              {preview.deleteCounts.families} families and {preview.deleteCounts.events} events
              and rebuild the tree from the file.
            </p>
          {/if}
        </div>
        {@render duplicatesBlock()}
        <div class="flex space-x-2 pt-2 border-t border-stone-200">
          <button
            type="button"
            onclick={onclose}
            disabled={isConfirming}
            class="px-4 py-2 text-xs font-medium text-stone-600 hover:text-stone-900 rounded-lg hover:bg-stone-200/60 transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          {#if preview.deleteCounts}
            <button
              type="button"
              onclick={() => confirm('replace')}
              disabled={isConfirming}
              class="flex-1 px-4 py-2 text-xs font-semibold bg-red-800 hover:bg-red-700 text-red-50 rounded-lg transition-colors cursor-pointer shadow-xs disabled:opacity-50"
            >
              Delete &amp; replace
            </button>
          {/if}
          <button
            type="button"
            onclick={() => confirm('merge')}
            disabled={isConfirming}
            class="flex-1 inline-flex items-center justify-center space-x-1.5 px-4 py-2 text-xs font-semibold bg-emerald-800 hover:bg-emerald-700 text-amber-50 rounded-lg transition-colors cursor-pointer shadow-xs disabled:opacity-50"
          >
            {#if isConfirming}
              <RefreshCw class="w-3.5 h-3.5 animate-spin mr-1" />
              <span>Merging...</span>
            {:else}
              <span>Merge into tree</span>
            {/if}
          </button>
        </div>
      {/if}
    </div>
  {/if}
</BaseModal>
