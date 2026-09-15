<script lang="ts">
  import { User, Calendar, MapPin, Heart } from 'lucide-svelte';

  interface Props {
    person: {
      id: string;
      name: string;
      dates?: string;
      photoUrl?: string;
      sex?: 'M' | 'F' | 'U';
      spouseName?: string;
    };
    onSelect?: (id: string) => void;
  }

  let { person, onSelect }: Props = $props();

  let isMale = $derived(person.sex === 'M');
  let isFemale = $derived(person.sex === 'F');
</script>

<button
  type="button"
  onclick={() => onSelect?.(person.id)}
  class="w-full h-full text-left bg-[#fdfbf7] hover:bg-[#fffefb] border rounded-xl p-3 flex items-center space-x-3 shadow-md hover:shadow-lg transition-all duration-200 group cursor-pointer"
  class:border-emerald-600={isMale}
  class:border-orange-500={isFemale}
  class:border-stone-300={!isMale && !isFemale}
>
  <!-- Avatar / Photo -->
  {#if person.photoUrl}
    <img
      src={person.photoUrl}
      alt={person.name}
      class="w-12 h-12 rounded-full object-cover ring-2 ring-stone-300 group-hover:ring-emerald-700 transition-all shrink-0"
    />
  {:else}
    <div
      class="w-12 h-12 rounded-full flex items-center justify-center ring-2 shrink-0 transition-all"
      class:bg-emerald-50={isMale}
      class:text-emerald-800={isMale}
      class:ring-emerald-300={isMale}
      class:group-hover:ring-emerald-600={isMale}
      class:bg-orange-50={isFemale}
      class:text-orange-800={isFemale}
      class:ring-orange-300={isFemale}
      class:group-hover:ring-orange-600={isFemale}
      class:bg-stone-100={!isMale && !isFemale}
      class:text-stone-600={!isMale && !isFemale}
      class:ring-stone-300={!isMale && !isFemale}
      class:group-hover:ring-stone-400={!isMale && !isFemale}
    >
      <User class="w-6 h-6" />
    </div>
  {/if}

  <!-- Content -->
  <div class="min-w-0 flex-1">
    <div class="flex items-center space-x-1">
      <p class="text-sm font-bold text-stone-900 truncate group-hover:text-emerald-900 transition-colors">
        {person.name || 'Unknown'}
      </p>
    </div>
    {#if person.dates}
      <div class="flex items-center text-xs text-stone-500 mt-0.5 truncate">
        <Calendar class="w-3 h-3 mr-1 shrink-0 text-stone-400" />
        <span class="truncate">{person.dates}</span>
      </div>
    {/if}
    {#if person.spouseName}
      <div class="flex items-center text-[11px] text-orange-800/90 mt-0.5 truncate font-medium">
        <Heart class="w-2.5 h-2.5 mr-1 shrink-0 fill-orange-500/40 text-orange-700" />
        <span class="truncate">{person.spouseName}</span>
      </div>
    {/if}
  </div>
</button>
