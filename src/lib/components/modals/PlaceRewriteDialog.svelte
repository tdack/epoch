<script lang="ts">
  import { tick } from 'svelte';
  import ImpactDialog from './ImpactDialog.svelte';
  import { isConflict, previewPlaceRewriteApi, rewritePlaceApi, suggestPlacesApi } from '#lib/services/tree-api.js';
  import type { ChangeSummary, ImpactSummary } from '#lib/types/genealogy.js';

  interface Props {
    show: boolean;
    treeId: string;
    /** The place being changed: its record and the name it has now. */
    placeId: string;
    currentName: string;
    /** Called after a save, with the change so the caller can offer Undo, and the text the place now has. */
    onsaved: (change: ChangeSummary | null, name: string) => void | Promise<void>;
    oncancel: () => void;
  }

  let { show, treeId, placeId, currentName, onsaved, oncancel }: Props = $props();

  const PREVIEW_DELAY_MS = 250;
  const field = 'w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600';

  let name = $state('');
  let impact = $state<ImpactSummary | null>(null);
  let previewError = $state<string | null>(null);
  let saveError = $state<string | null>(null);
  let isSaving = $state(false);
  let input = $state<HTMLInputElement | null>(null);
  let previewRequest = 0;
  // Places already on the tree's facts: choosing one is how a merge is asked for.
  let placeOptions = $state<string[]>([]);

  const isUnchanged = $derived(name.trim() === '' || name.trim() === currentName);

  $effect(() => {
    if (!show) return;
    name = currentName;
    impact = null;
    previewError = null;
    saveError = null;
    void tick().then(() => input?.select());
  });

  $effect(() => {
    const typed = name.trim();
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

  // What the change would write, planned on the server, so the list is the one the save runs.
  $effect(() => {
    if (!show) return;
    const typed = name.trim();
    const isIdle = isUnchanged;
    const timer = setTimeout(async () => {
      const request = ++previewRequest;
      if (isIdle) {
        impact = null;
        previewError = null;
        return;
      }
      try {
        const next = await previewPlaceRewriteApi(treeId, placeId, typed);
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
    if (isUnchanged) return;
    isSaving = true;
    saveError = null;
    try {
      const { change, name: saved } = await rewritePlaceApi(treeId, placeId, name.trim());
      await onsaved(change, saved);
    } catch (cause: unknown) {
      saveError = isConflict(cause) ? `${(cause as Error).message} Close this and try again.` : (cause as Error).message || 'Could not change the place';
    } finally {
      isSaving = false;
    }
  }
</script>

<ImpactDialog
  {show}
  title="Rename or merge this place"
  {impact}
  isLoading={show && !isUnchanged && impact === null && previewError === null}
  isConfirming={isSaving}
  error={saveError ?? previewError}
  confirmLabel="Change place"
  idleMessage="Type a new name to see which facts change."
  isConfirmBlocked={isUnchanged}
  onconfirm={save}
  {oncancel}
>
  {#snippet controls()}
    <form
      class="space-y-2"
      data-testid="place-form"
      onsubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label for="place-name" class="block text-xs font-semibold text-stone-700">Name on every fact at this place</label>
      <input id="place-name" type="text" bind:this={input} bind:value={name} list="place-name-options" autocomplete="off" class={field} />
      <datalist id="place-name-options">{#each placeOptions as option (option)}<option value={option}></option>{/each}</datalist>
      <p class="text-xs text-stone-600">Choose the name of another place to merge this one into it. One Undo puts everything back.</p>
    </form>
  {/snippet}
</ImpactDialog>
