<script lang="ts">
  import type { Snippet } from 'svelte';
  import { TriangleAlert } from 'lucide-svelte';
  import BaseModal from './BaseModal.svelte';
  import { groupRecords } from '#lib/shared/impact-groups.js';
  import type { ImpactSummary } from '#lib/types/genealogy.js';

  interface Props {
    /** Whether the dialog is open. */
    show: boolean;
    /** Dialog title, e.g. "Delete Homer Simpson?". */
    title: string;
    /** What the server says the action would change; null while it is being fetched. */
    impact: ImpactSummary | null;
    /** True while the preview is being fetched. */
    isLoading?: boolean;
    /** True while the confirmed action is running. */
    isConfirming?: boolean;
    /** A failure to preview or to confirm. */
    error?: string | null;
    /** Label of the confirm button, e.g. "Delete person". */
    confirmLabel: string;
    /** Choices that decide what is previewed (which partnerships to merge), shown above the preview. */
    controls?: Snippet;
    /** Shown instead of the preview while `impact` is null and nothing is loading (an open choice). */
    idleMessage?: string;
    /** Disables the confirm button while a choice is still open, however complete the preview looks. */
    isConfirmBlocked?: boolean;
    onconfirm: () => void;
    oncancel: () => void;
  }

  let {
    show,
    title,
    impact,
    isLoading = false,
    isConfirming = false,
    error = null,
    confirmLabel,
    controls,
    idleMessage = 'Checking what this affects…',
    isConfirmBlocked = false,
    onconfirm,
    oncancel
  }: Props = $props();

  const GROUP_LABELS: Record<string, string> = {
    person: 'People',
    name: 'Names',
    union: 'Partnerships',
    partner: 'Partners in a partnership',
    link: 'Parent and child links',
    event: 'Events',
    media: 'Attachments'
  };

  const ACTION_LABELS = { created: 'Added', updated: 'Changed', deleted: 'Deleted' } as const;

  // A moved record is listed once, as a move, not again as "Changed".
  const moves = $derived(impact?.moves ?? []);
  const movedIds = $derived(new Set(moves.map((m) => `${m.entityType}:${m.entityId}`)));
  const groups = $derived(
    impact ? groupRecords(impact.records.filter((r) => !movedIds.has(`${r.entityType}:${r.entityId}`))) : []
  );
  const people = $derived(impact?.people ?? []);

  let cancelButton: HTMLButtonElement | null = $state(null);

  // Cancel takes focus first: a destructive dialog should not be confirmed by a stray Enter.
  $effect(() => {
    if (show && cancelButton) cancelButton.focus();
  });
</script>

<BaseModal
  {show}
  {title}
  icon={TriangleAlert}
  iconBgClass="bg-red-100"
  iconBorderClass="border-red-300"
  iconTextClass="text-red-700"
  maxWidthClass="max-w-lg"
  {error}
  onclose={oncancel}
>
  <div class="space-y-3">
    {@render controls?.()}
    {#if isLoading || !impact}
      <p class="text-sm text-stone-600" role="status">{isLoading ? 'Checking what this affects…' : idleMessage}</p>
    {:else}
      <p class="text-sm font-medium text-stone-800">This is exactly what will change:</p>

      {#if people.length > 0}
        <section aria-labelledby="impact-people">
          <h4 id="impact-people" class="text-xs font-bold uppercase tracking-wider text-stone-600">People</h4>
          <ul class="mt-1 space-y-0.5 text-sm">
            {#each people as person (person.id)}
              <li>
                <span class="font-medium">{person.name}</span>
                <span class="text-xs {person.role === 'deleted' ? 'font-semibold text-red-700' : 'text-stone-500'}">
                  {person.role === 'deleted'
                    ? 'will be deleted'
                    : person.role === 'created'
                      ? 'will be added'
                      : 'stays, and their relationships change'}
                </span>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if moves.length > 0}
        <section aria-label="Moved records">
          <h4 class="text-xs font-bold uppercase tracking-wider text-stone-600">Moved</h4>
          <ul class="mt-1 space-y-1 text-sm">
            {#each moves as move (move.entityType + move.entityId)}
              <li>
                <span class="text-xs font-semibold text-stone-500">Moved</span>
                {move.label}
                <span class="block pl-3 text-xs text-stone-500">from the {move.from} to the {move.to}</span>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      {#each groups.filter((g) => g.entityType !== 'person') as group (group.entityType)}
        <section aria-label={GROUP_LABELS[group.entityType] ?? group.entityType}>
          <h4 class="text-xs font-bold uppercase tracking-wider text-stone-600">{GROUP_LABELS[group.entityType] ?? group.entityType}</h4>
          <ul class="mt-1 space-y-0.5 text-sm">
            {#each group.records as record (record.entityType + record.entityId)}
              <li>
                <span class="text-xs font-semibold {record.action === 'deleted' ? 'text-red-700' : 'text-stone-500'}">{ACTION_LABELS[record.action]}</span>
                {record.label}
              </li>
            {/each}
          </ul>
        </section>
      {/each}

      {#if groups.length === 0 && moves.length === 0}
        <p class="text-sm text-stone-600">Nothing would change.</p>
      {/if}
      <p class="text-xs text-stone-500">No other person or history is touched. You can undo this straight afterwards.</p>
    {/if}

    <div class="flex gap-2 pt-1">
      <button
        bind:this={cancelButton}
        type="button"
        onclick={oncancel}
        class="flex-1 cursor-pointer rounded-lg bg-stone-200 py-2 font-semibold text-stone-700 hover:bg-stone-300"
      >
        Cancel
      </button>
      <button
        type="button"
        onclick={onconfirm}
        disabled={isLoading || isConfirming || isConfirmBlocked || !impact}
        class="flex-1 cursor-pointer rounded-lg bg-red-700 py-2 font-semibold text-white hover:bg-red-600 disabled:opacity-50"
      >
        {isConfirming ? 'Working…' : confirmLabel}
      </button>
    </div>
  </div>
</BaseModal>
