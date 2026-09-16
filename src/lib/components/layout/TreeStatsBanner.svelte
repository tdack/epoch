<script lang="ts">
  import { Database, GitBranch, RefreshCw } from 'lucide-svelte';
  import type { TreeDetails } from '$lib/types/genealogy';

  interface Props {
    treeData: TreeDetails;
  }

  let { treeData }: Props = $props();
</script>

<div class="grid grid-cols-3 gap-4">
  <div class="bg-stone-50/90 border border-stone-200 rounded-xl p-4 flex items-center space-x-3.5 shadow-xs">
    <div class="w-10 h-10 rounded-lg bg-emerald-100/70 border border-emerald-300/60 flex items-center justify-center text-emerald-800">
      <Database class="w-5 h-5" />
    </div>
    <div>
      <p class="text-[11px] font-semibold text-stone-500 uppercase tracking-wider">Individuals in D1</p>
      <p class="text-xl font-bold text-stone-900">{treeData.individuals.length}</p>
    </div>
  </div>
  <div class="bg-stone-50/90 border border-stone-200 rounded-xl p-4 flex items-center space-x-3.5 shadow-xs">
    <div class="w-10 h-10 rounded-lg bg-orange-100/80 border border-orange-300/60 flex items-center justify-center text-orange-800">
      <GitBranch class="w-5 h-5" />
    </div>
    <div>
      <p class="text-[11px] font-semibold text-stone-500 uppercase tracking-wider">Families</p>
      <p class="text-xl font-bold text-stone-900">{treeData.families.length}</p>
    </div>
  </div>
  <div class="bg-stone-50/90 border border-stone-200 rounded-xl p-4 flex items-center space-x-3.5 shadow-xs">
    <div class="w-10 h-10 rounded-lg bg-amber-100/80 border border-amber-300/60 flex items-center justify-center text-amber-900">
      <RefreshCw class="w-5 h-5" />
    </div>
    <div class="min-w-0">
      <p class="text-[11px] font-semibold text-stone-500 uppercase tracking-wider">Active Tree</p>
      <p class="text-base font-bold text-stone-900 truncate">{treeData.tree.name}</p>
    </div>
  </div>
</div>
