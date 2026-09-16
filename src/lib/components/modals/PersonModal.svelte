<script lang="ts">
  import { UserPlus, Pencil, RefreshCw } from 'lucide-svelte';
  import BaseModal from './BaseModal.svelte';
  import type { PersonFormData } from '$lib/types/genealogy';

  interface Props {
    show: boolean;
    mode: 'add' | 'edit';
    initialPerson?: any | null;
    isSubmitting?: boolean;
    error?: string | null;
    onclose: () => void;
    onsubmit: (data: PersonFormData) => void;
  }

  let {
    show,
    mode,
    initialPerson = null,
    isSubmitting = false,
    error = null,
    onclose,
    onsubmit
  }: Props = $props();

  let givenName = $state('');
  let surname = $state('');
  let sex = $state<'M' | 'F' | 'U'>('U');
  let birthDate = $state('');
  let birthPlace = $state('');
  let deathDate = $state('');
  let deathPlace = $state('');
  let localError = $state<string | null>(null);

  $effect(() => {
    if (show) {
      localError = null;
      if (mode === 'edit' && initialPerson) {
        const raw = initialPerson.raw || {};
        givenName = raw.givenName || '';
        surname = raw.surname || '';
        sex = (initialPerson.sex as 'M' | 'F' | 'U') || raw.sex || 'U';

        const events = raw.events || [];
        const birthEvent = events.find((e: any) => e.type === 'BIRT');
        const deathEvent = events.find((e: any) => e.type === 'DEAT');

        birthDate = birthEvent?.dateRaw || '';
        birthPlace = birthEvent?.place || '';
        deathDate = deathEvent?.dateRaw || '';
        deathPlace = deathEvent?.place || '';
      } else {
        givenName = '';
        surname = '';
        sex = 'U';
        birthDate = '';
        birthPlace = '';
        deathDate = '';
        deathPlace = '';
      }
    }
  });

  function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!givenName.trim() && !surname.trim()) {
      localError = 'Please provide at least a given name or surname.';
      return;
    }
    localError = null;

    onsubmit({
      givenName: givenName.trim() || (mode === 'edit' ? null : undefined),
      surname: surname.trim() || (mode === 'edit' ? null : undefined),
      sex,
      birthDate: birthDate.trim() || (mode === 'edit' ? null : undefined),
      birthPlace: birthPlace.trim() || (mode === 'edit' ? null : undefined),
      deathDate: deathDate.trim() || (mode === 'edit' ? null : undefined),
      deathPlace: deathPlace.trim() || (mode === 'edit' ? null : undefined)
    });
  }
</script>

<BaseModal
  {show}
  title={mode === 'edit' ? 'Edit Person Details' : 'Add Individual'}
  icon={mode === 'edit' ? Pencil : UserPlus}
  iconBgClass="bg-emerald-100"
  iconBorderClass="border-emerald-300"
  iconTextClass="text-emerald-800"
  maxWidthClass={mode === 'edit' ? 'max-w-md' : 'max-w-lg'}
  error={error || localError}
  {onclose}
>
  <form onsubmit={handleSubmit} class="space-y-4">
    <div class="space-y-4">
      <!-- Names -->
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label for="person-given-name-field" class="text-xs font-semibold text-stone-700 block mb-1">Given Names</label>
          <input
            id="person-given-name-field"
            type="text"
            bind:value={givenName}
            placeholder={mode === 'edit' ? 'e.g. John' : 'e.g. John Edward'}
            disabled={isSubmitting}
            class="w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 disabled:opacity-50"
          />
        </div>
        <div>
          <label for="person-surname-field" class="text-xs font-semibold text-stone-700 block mb-1">Surname</label>
          <input
            id="person-surname-field"
            type="text"
            bind:value={surname}
            placeholder="e.g. Smith"
            disabled={isSubmitting}
            class="w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 disabled:opacity-50"
          />
        </div>
      </div>

      <!-- Sex -->
      <div>
        <span class="text-xs font-semibold text-stone-700 block mb-1.5">Sex</span>
        <div class="flex items-center space-x-4">
          <label class="inline-flex items-center text-xs text-stone-700 cursor-pointer">
            <input
              type="radio"
              name="person-form-sex"
              value="M"
              bind:group={sex}
              disabled={isSubmitting}
              class="text-emerald-800 focus:ring-emerald-600 mr-1.5"
            />
            Male
          </label>
          <label class="inline-flex items-center text-xs text-stone-700 cursor-pointer">
            <input
              type="radio"
              name="person-form-sex"
              value="F"
              bind:group={sex}
              disabled={isSubmitting}
              class="text-emerald-800 focus:ring-emerald-600 mr-1.5"
            />
            Female
          </label>
          <label class="inline-flex items-center text-xs text-stone-700 cursor-pointer">
            <input
              type="radio"
              name="person-form-sex"
              value="U"
              bind:group={sex}
              disabled={isSubmitting}
              class="text-emerald-800 focus:ring-emerald-600 mr-1.5"
            />
            Unknown
          </label>
        </div>
      </div>

      <!-- Birth Event -->
      <div class="border-t border-stone-200 pt-3">
        <h4 class="text-xs font-bold uppercase tracking-wider text-stone-600 mb-2">Birth Event</h4>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label for="person-birth-date-field" class="text-xs font-medium text-stone-600 block mb-1">Birth Date</label>
            <input
              id="person-birth-date-field"
              type="text"
              bind:value={birthDate}
              placeholder="e.g. 14 APR 1912"
              disabled={isSubmitting}
              class="w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-1.5 text-xs text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 disabled:opacity-50"
            />
          </div>
          <div>
            <label for="person-birth-place-field" class="text-xs font-medium text-stone-600 block mb-1">Birth Place</label>
            <input
              id="person-birth-place-field"
              type="text"
              bind:value={birthPlace}
              placeholder="e.g. Southampton, England"
              disabled={isSubmitting}
              class="w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-1.5 text-xs text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 disabled:opacity-50"
            />
          </div>
        </div>
      </div>

      <!-- Death Event -->
      <div class="border-t border-stone-200 pt-3">
        <h4 class="text-xs font-bold uppercase tracking-wider text-stone-600 mb-2">Death Event</h4>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label for="person-death-date-field" class="text-xs font-medium text-stone-600 block mb-1">Death Date</label>
            <input
              id="person-death-date-field"
              type="text"
              bind:value={deathDate}
              placeholder="e.g. 23 OCT 1985"
              disabled={isSubmitting}
              class="w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-1.5 text-xs text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 disabled:opacity-50"
            />
          </div>
          <div>
            <label for="person-death-place-field" class="text-xs font-medium text-stone-600 block mb-1">Death Place</label>
            <input
              id="person-death-place-field"
              type="text"
              bind:value={deathPlace}
              placeholder="e.g. New York, USA"
              disabled={isSubmitting}
              class="w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-1.5 text-xs text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 disabled:opacity-50"
            />
          </div>
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
        class="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold bg-emerald-800 hover:bg-emerald-700 text-amber-50 rounded-lg transition-colors cursor-pointer shadow-xs disabled:opacity-50"
      >
        {#if isSubmitting}
          <RefreshCw class="w-3.5 h-3.5 animate-spin mr-1" />
          <span>Saving...</span>
        {:else}
          <span>{mode === 'edit' ? 'Save Changes' : 'Add Person'}</span>
        {/if}
      </button>
    </div>
  </form>
</BaseModal>
