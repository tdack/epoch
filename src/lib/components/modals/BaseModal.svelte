<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    show: boolean;
    title: string;
    icon?: any;
    iconBgClass?: string;
    iconBorderClass?: string;
    iconTextClass?: string;
    maxWidthClass?: string;
    error?: string | null;
    subtitle?: string | null;
    onclose: () => void;
    children: Snippet;
    headerExtra?: Snippet;
  }

  let {
    show,
    title,
    icon: IconComponent,
    iconBgClass = 'bg-emerald-100',
    iconBorderClass = 'border-emerald-300',
    iconTextClass = 'text-emerald-800',
    maxWidthClass = 'max-w-md',
    error = null,
    subtitle = null,
    onclose,
    children,
    headerExtra
  }: Props = $props();
</script>

{#if show}
  <div class="fixed inset-0 z-50 bg-stone-950/40 backdrop-blur-xs flex items-center justify-center p-4">
    <div class="bg-[#fcfaf5] border border-stone-300/90 rounded-2xl w-full {maxWidthClass} p-6 space-y-4 shadow-2xl overflow-y-auto max-h-[90vh]">
      <div class="flex items-center space-x-2.5">
        {#if IconComponent}
          <div class="w-7 h-7 rounded-lg {iconBgClass} border {iconBorderClass} flex items-center justify-center {iconTextClass} shrink-0">
            <IconComponent class="w-4 h-4" />
          </div>
        {/if}
        <div class="min-w-0 flex-1">
          <h3 class="text-lg font-bold text-stone-900 truncate">{title}</h3>
          {#if subtitle}
            <p class="text-[11px] text-stone-500">{subtitle}</p>
          {/if}
        </div>
        {#if headerExtra}
          {@render headerExtra()}
        {/if}
      </div>

      {#if error}
        <div class="bg-orange-50 border border-orange-300 text-orange-900 rounded-lg p-2.5 text-xs font-medium">
          {error}
        </div>
      {/if}

      {@render children()}
    </div>
  </div>
{/if}

