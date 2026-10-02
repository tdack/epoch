<script lang="ts">
  import { Plus, Trash2, UserPlus, Upload, Download } from 'lucide-svelte';
  import EpochMark from '#lib/components/brand/EpochMark.svelte';
  import type { TreeSummary } from '#lib/types/genealogy.js';

  interface Props {
    trees: TreeSummary[];
    selectedTreeId: string | null;
    isImporting?: boolean;
    onselectTree: (id: string) => void;
    onopenNewTree: () => void;
    onopenDeleteTree: () => void;
    onopenAddPerson: () => void;
    onfileSelect: (e: Event) => void;
    onexportGedcom: () => void;
    /** Export carries every person, living ones included, so it is offered to managers and owners only. */
    canExport?: boolean;
  }

  let {
    trees = [],
    selectedTreeId,
    isImporting = false,
    onselectTree,
    onopenNewTree,
    onopenDeleteTree,
    onopenAddPerson,
    onfileSelect,
    onexportGedcom,
    canExport = false
  }: Props = $props();
</script>

<header class="min-h-16 border-b border-stone-200/80 bg-[#fdfbf7]/90 backdrop-blur-md px-3 py-2 sm:px-6 flex flex-wrap items-center justify-between gap-2 sticky top-0 z-30 shadow-xs">
  <div class="flex items-center space-x-3">
    <div class="w-9 h-9 rounded-xl bg-emerald-800 flex items-center justify-center shadow-md shadow-emerald-900/15">
      <EpochMark size={22} ink="#fffbeb" ancestryOpacity={0.5} />
    </div>
    <div>
      <h1 class="text-base font-bold text-stone-900 tracking-tight">
        Epoch
      </h1>
      <p class="text-[10px] text-stone-500 font-medium tracking-wide">Family history</p>
    </div>
  </div>

  <!-- Tree Selector & Actions -->
  <div class="flex flex-wrap items-center gap-2">
    {#if trees.length > 0}
      <select
        aria-label="Tree"
        value={selectedTreeId}
        onchange={(e) => onselectTree(e.currentTarget.value)}
        class="bg-stone-50 text-xs font-medium text-stone-800 border border-stone-300 rounded-lg px-3 py-1.5 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 shadow-xs"
      >
        {#each trees as t (t.id)}
          <option value={t.id}>{t.name}</option>
        {/each}
      </select>
    {/if}

    <button
      type="button"
      onclick={onopenNewTree}
      class="inline-flex items-center space-x-1.5 text-xs font-semibold bg-stone-100 hover:bg-stone-200/80 text-stone-800 border border-stone-300 rounded-lg px-3 py-1.5 transition-colors cursor-pointer shadow-xs"
    >
      <Plus class="w-3.5 h-3.5 text-emerald-800" />
      <span>New Tree</span>
    </button>

    {#if selectedTreeId}
      <!-- Delete Tree Action -->
      <button
        type="button"
        onclick={onopenDeleteTree}
        title="Delete this tree"
        aria-label="Delete this tree"
        class="inline-flex items-center justify-center text-xs font-semibold bg-stone-100 hover:bg-red-50 text-red-700 border border-stone-300 hover:border-red-300 rounded-lg px-2.5 py-1.5 transition-colors cursor-pointer shadow-xs"
      >
        <Trash2 class="w-3.5 h-3.5" />
      </button>

      <!-- Add Person Action -->
      <button
        type="button"
        onclick={onopenAddPerson}
        class="inline-flex items-center space-x-1.5 text-xs font-semibold bg-emerald-800 hover:bg-emerald-700 text-amber-50 rounded-lg px-3 py-1.5 transition-colors cursor-pointer shadow-sm shadow-emerald-900/15"
      >
        <UserPlus class="w-3.5 h-3.5" />
        <span>Add Person</span>
      </button>
    {/if}

    <!-- Import GEDCOM -->
    <label class="inline-flex items-center space-x-1.5 text-xs font-semibold bg-stone-100 hover:bg-stone-200/80 text-stone-800 border border-stone-300 rounded-lg px-3 py-1.5 transition-colors cursor-pointer shadow-xs">
      <Upload class="w-3.5 h-3.5 text-stone-600" />
      <span>Import GEDCOM</span>
      <input
        type="file"
        accept=".ged,.gedcom"
        onchange={onfileSelect}
        class="hidden"
        disabled={isImporting}
      />
    </label>

    <!-- Export GEDCOM -->
    {#if selectedTreeId && canExport}
      <button
        type="button"
        onclick={onexportGedcom}
        class="inline-flex items-center space-x-1.5 text-xs font-semibold bg-stone-100 hover:bg-stone-200/80 text-stone-800 border border-stone-300 rounded-lg px-3 py-1.5 transition-colors cursor-pointer shadow-xs"
      >
        <Download class="w-3.5 h-3.5 text-stone-600" />
        <span>Export 5.5.1</span>
      </button>
    {/if}
  </div>
</header>
