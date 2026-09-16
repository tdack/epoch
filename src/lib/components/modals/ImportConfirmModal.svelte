<script lang="ts">
  import { Upload, RefreshCw } from 'lucide-svelte';
  import BaseModal from './BaseModal.svelte';
  import type { ImportPreviewData } from '$lib/types/genealogy';

  interface Props {
    show: boolean;
    treeName?: string;
    hasSelectedTree: boolean;
    preview: ImportPreviewData | null;
    isLoadingPreview?: boolean;
    isConfirming?: boolean;
    error?: string | null;
    onclose: () => void;
    onconfirm: (mode: 'replace' | 'merge') => void;
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
</script>

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
        <strong>{preview.incoming.families}</strong> families and
        <strong>{preview.incoming.events}</strong> events.
      </p>

      {#if !hasSelectedTree}
        <div class="bg-stone-100 border border-stone-300 rounded-lg p-3 space-y-1">
          <p class="font-semibold text-stone-900">New tree</p>
          <p>All {preview.incoming.individuals} people and {preview.incoming.families} families from the file will be imported into a fresh tree.</p>
        </div>
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
            onclick={() => onconfirm('replace')}
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
            {preview.incoming.families} families from the file.
          </p>
        </div>
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
            onclick={() => onconfirm('merge')}
            disabled={isConfirming}
            class="flex-1 px-4 py-2 text-xs font-semibold text-stone-700 border border-stone-300 hover:bg-stone-200/60 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
          >
            Merge instead
          </button>
          <button
            type="button"
            onclick={() => onconfirm('replace')}
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
            <li>{preview.merge.newFamilies} new families; {preview.merge.mergedFamilies} duplicate families will be merged into existing ones</li>
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
              onclick={() => onconfirm('replace')}
              disabled={isConfirming}
              class="flex-1 px-4 py-2 text-xs font-semibold bg-red-800 hover:bg-red-700 text-red-50 rounded-lg transition-colors cursor-pointer shadow-xs disabled:opacity-50"
            >
              Delete &amp; replace
            </button>
          {/if}
          <button
            type="button"
            onclick={() => onconfirm('merge')}
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
