<script lang="ts">
  import { tick, untrack } from 'svelte';
  import ImpactDialog from './ImpactDialog.svelte';
  import DateInput from '#lib/components/forms/DateInput.svelte';
  import { checkDateText } from '#lib/shared/date-value.js';
  import { FACT_KINDS, FACT_TYPE_LIST, factTypeInfo, type FactInput } from '#lib/shared/fact-types.js';
  import type { FactDto } from '#lib/server/services/person-page-service.js';
  import { createFactApi, isConflict, previewFactApi, suggestPlacesApi, updateFactApi } from '#lib/services/tree-api.js';
  import type { ChangeSummary, ImpactSummary } from '#lib/types/genealogy.js';

  interface Props {
    show: boolean;
    treeId: string;
    personId: string;
    /** The fact being edited, or null to add one. */
    fact: FactDto | null;
    /** Called after a save, with the change so the caller can offer Undo. */
    onsaved: (change: ChangeSummary | null) => void | Promise<void>;
    /** Called when the fact changed under the person; the caller reloads and reopens with what is stored. */
    onstale: (message: string) => void | Promise<void>;
    oncancel: () => void;
  }

  let { show, treeId, personId, fact, onsaved, onstale, oncancel }: Props = $props();

  const PREVIEW_DELAY_MS = 250;
  const EVENT_TYPES = FACT_TYPE_LIST.filter((t) => t.kind === FACT_KINDS.EVENT);
  const ATTRIBUTE_TYPES = FACT_TYPE_LIST.filter((t) => t.kind === FACT_KINDS.ATTRIBUTE);

  let type = $state('EVEN');
  let dateText = $state('');
  let place = $state('');
  let value = $state('');
  let cause = $state('');
  let age = $state('');
  let notes = $state('');

  let impact = $state<ImpactSummary | null>(null);
  let previewError = $state<string | null>(null);
  let saveError = $state<string | null>(null);
  let isSaving = $state(false);
  let typeSelect = $state<HTMLSelectElement | null>(null);
  let previewRequest = 0;
  // Places already on the tree's facts, offered as the user types so one place keeps one spelling.
  // A suggestion fills in the text only; what is saved is whatever the field holds.
  let placeOptions = $state<string[]>([]);
  $effect(() => {
    const typed = place.trim();
    if (!show || typed.length < 2) {
      placeOptions = [];
      return;
    }
    const timer = setTimeout(async () => {
      try {
        placeOptions = await suggestPlacesApi(treeId, typed);
      } catch {
        placeOptions = [];
      }
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  });

  const isEdit = $derived(fact !== null);
  const isAttribute = $derived(factTypeInfo(type)?.kind === FACT_KINDS.ATTRIBUTE);
  const isDateValid = $derived(checkDateText(dateText).isValid);
  const field = 'w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600';

  const toInput = (): FactInput => ({
    type,
    dateText: dateText.trim() || null,
    place: place.trim() || null,
    value: value.trim() || null,
    cause: cause.trim() || null,
    age: age.trim() || null,
    notes: notes.trim() || null
  });

  // Fill the form only when the dialog opens: reading `fact` inside the effect that also watches the
  // fields would wipe what has been typed whenever the page data reloads underneath it.
  $effect(() => {
    if (!show) return;
    const source = untrack(() => fact);
    type = source?.type ?? 'OCCU';
    dateText = source?.dateText ?? '';
    place = source?.place ?? '';
    value = source?.value ?? '';
    cause = source?.cause ?? '';
    age = source?.age ?? '';
    notes = source?.notes ?? '';
    impact = null;
    previewError = null;
    saveError = null;
    void tick().then(() => typeSelect?.focus());
  });

  // What the save would write, refreshed as the form changes. Planned on the server, so the list is
  // the same operations the save runs.
  $effect(() => {
    if (!show) return;
    const input = toInput();
    const isValid = isDateValid;
    const source = untrack(() => fact);
    const timer = setTimeout(async () => {
      const request = ++previewRequest;
      if (!isValid) {
        impact = null;
        return;
      }
      try {
        const next = source
          ? await previewFactApi(treeId, { kind: 'update_fact', factId: source.id, version: source.version, fact: input })
          : await previewFactApi(treeId, { kind: 'create_fact', personId, fact: input });
        if (request !== previewRequest) return;
        impact = next;
        previewError = null;
      } catch (cause: unknown) {
        if (request !== previewRequest) return;
        impact = null;
        previewError = (cause as Error).message;
      }
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  });

  async function save() {
    if (!isDateValid) {
      saveError = 'Fix the highlighted date before saving.';
      return;
    }
    isSaving = true;
    saveError = null;
    try {
      const input = toInput();
      const { change } = fact ? await updateFactApi(treeId, fact.id, input, fact.version) : await createFactApi(treeId, personId, input);
      await onsaved(change);
    } catch (cause: unknown) {
      if (isConflict(cause)) await onstale(cause.message);
      else saveError = (cause as Error).message || 'Could not save the fact';
    } finally {
      isSaving = false;
    }
  }
</script>

<ImpactDialog
  {show}
  title={isEdit ? 'Edit fact' : 'Add a fact'}
  {impact}
  isLoading={show && impact === null && previewError === null && isDateValid}
  isConfirming={isSaving}
  error={saveError ?? previewError}
  confirmLabel={isEdit ? 'Save fact' : 'Add fact'}
  idleMessage="Fix the date to see what will change."
  isConfirmBlocked={!isDateValid}
  onconfirm={save}
  {oncancel}
>
  {#snippet controls()}
    <form
      class="space-y-3"
      data-testid="fact-form"
      onsubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div>
        <label for="fact-type" class="mb-1 block text-xs font-semibold text-stone-700">Type</label>
        <select id="fact-type" bind:this={typeSelect} bind:value={type} class={field}>
          <optgroup label="Events">
            {#each EVENT_TYPES as info (info.code)}<option value={info.code}>{info.label}</option>{/each}
          </optgroup>
          <optgroup label="Attributes">
            {#each ATTRIBUTE_TYPES as info (info.code)}<option value={info.code}>{info.label}</option>{/each}
          </optgroup>
        </select>
      </div>

      {#if isAttribute}
        <div>
          <label for="fact-value" class="mb-1 block text-xs font-semibold text-stone-700">Value</label>
          <input id="fact-value" type="text" bind:value class={field} placeholder="e.g. Carpenter" />
        </div>
      {/if}

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label for="fact-date" class="mb-1 block text-xs font-semibold text-stone-700">Date</label>
          <DateInput id="fact-date" bind:value={dateText} inputClass={field} />
        </div>
        <div>
          <label for="fact-place" class="mb-1 block text-xs font-semibold text-stone-700">Place</label>
          <input id="fact-place" type="text" bind:value={place} list="fact-place-options" autocomplete="off" class={field} placeholder="e.g. Leeds, Yorkshire" />
          <datalist id="fact-place-options">{#each placeOptions as option (option)}<option value={option}></option>{/each}</datalist>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label for="fact-cause" class="mb-1 block text-xs font-semibold text-stone-700">Cause</label>
          <input id="fact-cause" type="text" bind:value={cause} class={field} />
        </div>
        <div>
          <label for="fact-age" class="mb-1 block text-xs font-semibold text-stone-700">Age</label>
          <input id="fact-age" type="text" bind:value={age} class={field} placeholder="e.g. 79y" />
        </div>
      </div>

      {#if !isAttribute}
        <div>
          <label for="fact-value-event" class="mb-1 block text-xs font-semibold text-stone-700">Value <span class="font-normal text-stone-500">(optional)</span></label>
          <input id="fact-value-event" type="text" bind:value class={field} />
        </div>
      {/if}

      <div>
        <label for="fact-notes" class="mb-1 block text-xs font-semibold text-stone-700">Notes</label>
        <textarea id="fact-notes" rows="2" bind:value={notes} class={field}></textarea>
      </div>
    </form>
  {/snippet}
</ImpactDialog>
