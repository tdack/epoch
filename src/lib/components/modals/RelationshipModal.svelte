<script lang="ts">
  import { untrack } from 'svelte';
  import { UserPlus, Baby, Heart, Search, Sparkles, Cross, HeartCrack, Users } from 'lucide-svelte';
  import BaseModal from './BaseModal.svelte';
  import ConflictDialog from './ConflictDialog.svelte';
  import { differingRows, type ConflictRow } from './conflict.js';
  import {
    searchPeopleApi,
    planRelationshipApi,
    applyRelationshipApi,
    isConflict,
    type ConflictError
  } from '#lib/services/tree-api.js';
  import { personName } from '#lib/shared/person-name.js';
  import { partnershipLabels } from '#lib/shared/partnership-labels.js';
  import DateInput from '#lib/components/forms/DateInput.svelte';
  import { checkDateText } from '#lib/shared/date-value.js';
  import {
    END_EVENT_TYPES,
    ENDED_UNION_STATUSES,
    SUGGESTED_END_EVENT,
    UNION_EVENT_LABELS,
    UNION_STATUS_LABELS,
    type EndedUnionStatus
  } from '#lib/shared/union-events.js';
  import type {
    ChangeSummary,
    RelationshipGraph,
    RelationshipIntent,
    ParentChildType,
    ParentRole,
    PeopleSearchResult,
    RelationshipKind,
    RelationshipPlan,
    UnionEventType
  } from '#lib/types/genealogy.js';

  interface Props {
    /** Whether the dialog is open. */
    show: boolean;
    treeId: string;
    /** The person who is the anchor/subject of this relationship edit. */
    anchor: { id: string; givenName: string | null; surname: string | null };
    /** The graph, for the anchor's version, partnerships and existing death. */
    graph: RelationshipGraph;
    /** Optional counterpart already known (e.g. from drag-to-relate). */
    preselect?: { id: string; givenName: string | null; surname: string | null } | null;
    /** Which form to open on. */
    initialKind?: RelationshipKind;
    /** The partnership to preselect for "end partnership". */
    initialUnionId?: string | null;
    onclose: () => void;
    /** Called with the logged change after a successful save, so the caller can refresh and offer Undo. */
    onsaved: (change: ChangeSummary | null, plan: RelationshipPlan) => void;
    /** Reload the graph after a conflict so the next save starts from current versions. */
    onrefresh: () => Promise<void>;
  }

  let {
    show,
    treeId,
    anchor,
    graph,
    preselect = null,
    initialKind = 'add_parent',
    initialUnionId = null,
    onclose,
    onsaved,
    onrefresh
  }: Props = $props();

  let kind = $state<RelationshipKind>('add_parent');
  let role = $state<ParentRole>('parent');
  let type = $state<ParentChildType>('biological');
  let searchQuery = $state('');
  let results = $state<PeopleSearchResult[]>([]);
  let selected = $state<PeopleSearchResult | null>(null);
  let newGivenName = $state('');
  let newSurname = $state('');
  let useNewPerson = $state(false);
  let deathDate = $state('');
  let deathPlace = $state('');
  let chosenUnionId = $state<string | null>(null);
  /** The partnership the person picked for add child, add parent or add partner. Undefined: let the server choose. */
  let unionOverride = $state<string | null | undefined>(undefined);
  let endStatus = $state<EndedUnionStatus>('divorced');
  let endEventType = $state<UnionEventType | ''>('DIV');
  let endDate = $state('');
  let endPlace = $state('');
  /** Which parents an added sibling shares. Undefined: the first option, the biological parents. */
  let siblingOptionKey = $state<string | undefined>(undefined);
  let plan = $state<RelationshipPlan | null>(null);
  let isPlanning = $state(false);
  let isSearching = $state(false);
  let isSubmitting = $state(false);
  let error = $state<string | null>(null);
  let conflict = $state<ConflictError | null>(null);

  const typeOptions: Array<{ value: ParentChildType; label: string }> = [
    { value: 'biological', label: 'Biological' },
    { value: 'adoptive', label: 'Adoptive' },
    { value: 'foster', label: 'Foster' },
    { value: 'guardian', label: 'Guardian' },
    { value: 'unknown', label: 'Unknown / other' }
  ];

  const roleOptions: Array<{ value: ParentRole; label: string }> = [
    { value: 'parent', label: 'Parent' },
    { value: 'mother', label: 'Mother' },
    { value: 'father', label: 'Father' }
  ];

  const kinds: Array<{ v: RelationshipKind; label: string; icon: typeof UserPlus }> = [
    { v: 'add_parent', label: 'Add parent', icon: UserPlus },
    { v: 'add_child', label: 'Add child', icon: Baby },
    { v: 'add_sibling', label: 'Add sibling', icon: Users },
    { v: 'add_partner', label: 'Add partner', icon: Heart },
    { v: 'record_death', label: 'Record death', icon: Cross },
    { v: 'end_union', label: 'End partnership', icon: HeartCrack }
  ];

  const anchorPerson = $derived(graph.people.find((p) => p.id === anchor.id));
  const anchorUnions = $derived(graph.unions.filter((u) => u.partnerIds.includes(anchor.id)));
  // With one partnership there is nothing to choose, and the graph may still be reloading when the
  // dialog opens, so the single one is derived rather than copied in at open time.
  const effectiveUnionId = $derived(chosenUnionId ?? (anchorUnions.length === 1 ? anchorUnions[0].id : null));
  const chosenUnion = $derived(anchorUnions.find((u) => u.id === effectiveUnionId) ?? null);
  const nameOf = (id: string) => graph.people.find((p) => p.id === id)?.displayName ?? id;
  const unionLabels = $derived(partnershipLabels(graph.unions));

  interface UnionOption {
    /** Null for "a new partnership" when adding a partner. */
    id: string | null;
    title: string;
    detail: string;
  }

  function optionFor(union: RelationshipGraph['unions'][number]): UnionOption {
    const names = union.partnerIds.map(nameOf);
    const childCount = new Set(union.children.map((c) => c.childId)).size;
    const detail = [
      unionLabels.get(union.id)?.full,
      childCount === 1 ? '1 child' : `${childCount} children`,
      union.partnerIds.length < 2 ? 'one partner recorded' : null
    ]
      .filter(Boolean)
      .join(' · ');
    return { id: union.id, title: names.length > 0 ? names.join(' and ') : 'Unknown partners', detail };
  }

  // A chooser is only worth showing when there is something to choose between. Add-partner always
  // offers "a new partnership" next to the ones still waiting for a partner, because filling the
  // wrong waiting one is exactly the mistake the chooser exists to prevent.
  const unionOptions = $derived.by((): UnionOption[] => {
    if (kind === 'add_child') return anchorUnions.map(optionFor);
    if (kind === 'add_parent') {
      const ids = new Set(graph.parentChild.filter((l) => l.childId === anchor.id && l.unionId).map((l) => l.unionId));
      return graph.unions.filter((u) => ids.has(u.id)).map(optionFor);
    }
    if (kind === 'add_partner') {
      const waiting = anchorUnions.filter((u) => u.partnerIds.length === 1).map(optionFor);
      return waiting.length > 0 ? [...waiting, { id: null, title: 'A new partnership', detail: 'Start a separate partnership with them' }] : [];
    }
    return [];
  });
  const showUnionChooser = $derived(kind === 'add_partner' ? unionOptions.length > 0 : unionOptions.length > 1);
  const selectedUnionId = $derived(unionOverride !== undefined ? unionOverride : (plan?.unionChoice?.unionId ?? null));
  const unionChooserLegend = $derived(
    kind === 'add_parent' ? 'Which parental family' : kind === 'add_partner' ? 'Which partnership to fill' : 'Which partnership'
  );

  interface SiblingOption {
    key: string;
    parentIds: string[];
    title: string;
    detail: string;
  }

  // A sibling is someone who shares a parent, so the choice is which of the person's parents. Whole
  // families come first, biological ones at the top, then each parent alone for a half-sibling.
  const siblingOptions = $derived.by((): SiblingOption[] => {
    const groups = new Map<string, Array<{ parentId: string; type: ParentChildType }>>();
    for (const link of graph.parentChild) {
      if (link.childId !== anchor.id) continue;
      const key = link.unionId ?? 'direct';
      groups.set(key, [...(groups.get(key) ?? []), { parentId: link.parentId, type: link.type }]);
    }
    const typeLabel = (type: ParentChildType) => typeOptions.find((t) => t.value === type)?.label.toLowerCase() ?? type;
    const whole = [...groups.entries()].map(([key, links]): SiblingOption & { isBiological: boolean } => {
      const parentIds = [...new Set(links.map((l) => l.parentId))];
      const types = [...new Set(links.map((l) => l.type))];
      return {
        key,
        parentIds,
        title: parentIds.map(nameOf).join(' and '),
        detail: `${parentIds.length > 1 ? 'Both parents' : 'One recorded parent'} · ${types.map(typeLabel).join(', ')}`,
        isBiological: types.every((t) => t === 'biological')
      };
    });
    whole.sort((a, b) => Number(b.isBiological) - Number(a.isBiological));
    const halves = whole
      .filter((g) => g.parentIds.length > 1)
      .flatMap((g) => g.parentIds.map((id) => ({ key: `${g.key}:${id}`, parentIds: [id], title: `${nameOf(id)} only`, detail: 'A half-sibling: one shared parent' })));
    return [...whole.map(({ isBiological: _, ...option }) => option), ...halves];
  });
  const effectiveSiblingKey = $derived(siblingOptionKey ?? siblingOptions[0]?.key ?? null);
  const siblingOption = $derived(siblingOptions.find((o) => o.key === effectiveSiblingKey) ?? null);

  function selectKind(next: RelationshipKind) {
    kind = next;
    unionOverride = undefined;
  }

  function reset() {
    kind = initialKind;
    role = 'parent';
    type = 'biological';
    searchQuery = '';
    results = [];
    selected = preselect
      ? { id: preselect.id, givenName: preselect.givenName ?? null, surname: preselect.surname ?? null }
      : null;
    newGivenName = '';
    newSurname = '';
    useNewPerson = false;
    deathDate = anchorPerson?.deathDate ?? '';
    deathPlace = '';
    // With several partnerships the person must pick, never a default.
    // A form opened from one partnership's own "+ Add" starts on it; otherwise the server chooses.
    unionOverride = initialUnionId && (initialKind === 'add_child' || initialKind === 'add_parent' || initialKind === 'add_partner') ? initialUnionId : undefined;
    siblingOptionKey = undefined;
    chosenUnionId = initialUnionId;
    endStatus = 'divorced';
    endEventType = 'DIV';
    endDate = '';
    endPlace = '';
    plan = null;
    error = null;
    conflict = null;
  }

  // Reset only when the dialog opens. Reading the graph inside `reset` must not make it re-run: the
  // graph reloads after every save, and a late reload would wipe what the person has typed.
  $effect(() => {
    if (show) untrack(reset);
  });

  function pickStatus(status: EndedUnionStatus) {
    endStatus = status;
    endEventType = SUGGESTED_END_EVENT[status] ?? '';
  }

  async function runSearch() {
    if (!searchQuery.trim()) {
      results = [];
      return;
    }
    isSearching = true;
    try {
      results = await searchPeopleApi(treeId, searchQuery);
    } catch (e: any) {
      error = e.message;
    } finally {
      isSearching = false;
    }
  }

  function otherPerson() {
    if (useNewPerson) {
      if (!newGivenName.trim() && !newSurname.trim()) return null;
      return { id: 'new', givenName: newGivenName.trim() || null, surname: newSurname.trim() || null, isNew: true };
    }
    return selected ? { id: selected.id, givenName: selected.givenName, surname: selected.surname } : null;
  }

  function buildIntent(versionOverride?: { person?: number; union?: number }): RelationshipIntent | null {
    if (kind === 'record_death') {
      return {
        kind,
        person: anchor,
        dateText: deathDate.trim() || null,
        place: deathPlace.trim() || null,
        personVersion: versionOverride?.person ?? anchorPerson?.version
      };
    }
    if (kind === 'end_union') {
      if (!chosenUnion) return null;
      return {
        kind,
        person: anchor,
        unionId: chosenUnion.id,
        status: endStatus,
        event: endEventType
          ? { type: endEventType, dateText: endDate.trim() || null, place: endPlace.trim() || null }
          : null,
        unionVersion: versionOverride?.union ?? chosenUnion.version
      };
    }
    const other = otherPerson();
    if (!other) return null;
    if (kind === 'add_partner') return { kind, person: anchor, partner: other, unionLabel: null, unionId: unionOverride };
    if (kind === 'add_sibling') return siblingOption ? { kind, person: anchor, sibling: other, parentIds: siblingOption.parentIds, type } : null;
    if (kind === 'add_parent') return { kind, child: anchor, parent: other, type, role, unionLabel: null, unionId: unionOverride };
    return { kind, parent: anchor, child: other, type, unionLabel: null, unionId: unionOverride };
  }

  // Preview from the server, so the sentence and records shown are the ones the save will write.
  $effect(() => {
    if (!show) return;
    const intent = buildIntent();
    if (!intent) {
      plan = null;
      return;
    }
    let isStale = false;
    const timer = setTimeout(async () => {
      isPlanning = true;
      try {
        const next = await planRelationshipApi(treeId, intent);
        if (!isStale) {
          plan = next;
          error = null;
        }
      } catch (e: any) {
        if (!isStale) {
          plan = null;
          error = e.message;
        }
      } finally {
        if (!isStale) isPlanning = false;
      }
    }, 250);
    return () => {
      isStale = true;
      clearTimeout(timer);
    };
  });

  // Only the date the current form shows counts; a stale value in a hidden field must not block saving.
  const hasDateProblem = $derived(
    (kind === 'record_death' && !checkDateText(deathDate).isValid) ||
      (kind === 'end_union' && Boolean(endEventType) && !checkDateText(endDate).isValid)
  );
  const canSave = $derived(Boolean(plan) && plan!.commands.length > 0 && !isSubmitting && !isPlanning && !hasDateProblem);

  async function submit(versionOverride?: { person?: number; union?: number }) {
    const intent = buildIntent(versionOverride);
    if (!intent) {
      error = kind === 'end_union' ? 'Choose which partnership to end.' : 'Select an existing person or enter a new person.';
      return;
    }
    isSubmitting = true;
    error = null;
    try {
      const saved = await applyRelationshipApi(treeId, intent);
      conflict = null;
      onsaved(saved.change, saved.plan);
    } catch (e: any) {
      if (isConflict(e)) conflict = e;
      else error = e.message;
    } finally {
      isSubmitting = false;
    }
  }

  const conflictRows = $derived.by((): ConflictRow[] => {
    if (!conflict) return [];
    const current = conflict.details.current;
    if (conflict.details.entity === 'individual') {
      return differingRows([
        { label: 'Death date', yours: deathDate, current: current.deathDate },
        { label: 'Death place', yours: deathPlace, current: current.deathPlace }
      ]);
    }
    const stored = (current.events as Array<{ type: string; dateText: string | null; place: string | null }>) ?? [];
    const storedEnd = stored.find((e) => e.type === endEventType);
    return differingRows([
      { label: 'Status', yours: UNION_STATUS_LABELS[endStatus], current: UNION_STATUS_LABELS[current.status as keyof typeof UNION_STATUS_LABELS] ?? current.status },
      { label: 'End date', yours: endDate, current: storedEnd?.dateText },
      { label: 'End place', yours: endPlace, current: storedEnd?.place }
    ]);
  });

  async function reloadAfterConflict() {
    conflict = null;
    await onrefresh();
    reset();
  }

  async function reapplyAfterConflict() {
    if (!conflict) return;
    const version = conflict.details.currentVersion;
    await submit(conflict.details.entity === 'individual' ? { person: version } : { union: version });
  }

  const partnersLabel = (union: RelationshipGraph['unions'][number]) => {
    const others = union.partnerIds.filter((id) => id !== anchor.id).map(nameOf);
    return others.length > 0 ? `with ${others.join(' and ')}` : 'with an unknown partner';
  };
</script>

<BaseModal
  {show}
  title={kind === 'record_death' ? 'Record death' : kind === 'end_union' ? 'End partnership' : 'Add relationship'}
  subtitle={personName(anchor)}
  icon={Sparkles}
  maxWidthClass="max-w-lg"
  onclose={onclose}
  {error}
>
  <div class="space-y-4">
    <div class="grid grid-cols-3 gap-1.5 sm:grid-cols-6" role="group" aria-label="What to record">
      {#each kinds as item (item.v)}
        <button
          type="button"
          onclick={() => selectKind(item.v)}
          aria-pressed={kind === item.v}
          class="p-2 rounded-lg border text-[11px] leading-tight font-medium flex flex-col items-center gap-1 cursor-pointer {kind === item.v ? 'bg-emerald-100 border-emerald-400 text-emerald-900' : 'bg-white border-stone-300 text-stone-600'}"
        >
          <item.icon class="w-4 h-4" />
          {item.label}
        </button>
      {/each}
    </div>

    {#if kind === 'add_parent' || kind === 'add_child' || kind === 'add_sibling'}
      <div class="space-y-2">
        <label class="block text-xs font-semibold text-stone-700" for="rel-type">Relationship type</label>
        <select id="rel-type" bind:value={type} class="w-full rounded-lg border border-stone-300 bg-white p-2 text-sm">
          {#each typeOptions as t (t.value)}
            <option value={t.value}>{t.label}</option>
          {/each}
        </select>
        {#if kind === 'add_parent'}
          <label class="block text-xs font-semibold text-stone-700" for="rel-role">Role</label>
          <select id="rel-role" bind:value={role} class="w-full rounded-lg border border-stone-300 bg-white p-2 text-sm">
            {#each roleOptions as r (r.value)}
              <option value={r.value}>{r.label}</option>
            {/each}
          </select>
        {/if}
      </div>
    {/if}

    {#if kind === 'add_parent' || kind === 'add_child' || kind === 'add_partner' || (kind === 'add_sibling' && siblingOptions.length > 0)}
      <div class="flex items-center gap-2">
        <button
          type="button"
          onclick={() => (useNewPerson = false)}
          aria-pressed={!useNewPerson}
          class="px-3 py-1.5 rounded-lg text-xs font-medium border cursor-pointer {!useNewPerson ? 'bg-emerald-100 border-emerald-400 text-emerald-900' : 'bg-white border-stone-300 text-stone-600'}"
        >
          Existing person
        </button>
        <button
          type="button"
          onclick={() => (useNewPerson = true)}
          aria-pressed={useNewPerson}
          class="px-3 py-1.5 rounded-lg text-xs font-medium border cursor-pointer {useNewPerson ? 'bg-emerald-100 border-emerald-400 text-emerald-900' : 'bg-white border-stone-300 text-stone-600'}"
        >
          New person
        </button>
      </div>

      {#if useNewPerson}
        <div class="space-y-2">
          <label class="block text-xs font-semibold text-stone-700" for="new-given">Given name</label>
          <input id="new-given" type="text" bind:value={newGivenName} class="w-full rounded-lg border border-stone-300 bg-white p-2 text-sm" />
          <label class="block text-xs font-semibold text-stone-700" for="new-surname">Surname</label>
          <input id="new-surname" type="text" bind:value={newSurname} class="w-full rounded-lg border border-stone-300 bg-white p-2 text-sm" />
        </div>
      {:else}
        <div class="space-y-2">
          <label class="block text-xs font-semibold text-stone-700" for="rel-search">Search people by name</label>
          <div class="flex gap-2">
            <input
              id="rel-search"
              type="text"
              bind:value={searchQuery}
              onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } }}
              class="flex-1 rounded-lg border border-stone-300 bg-white p-2 text-sm"
            />
            <button type="button" onclick={runSearch} aria-label="Search" class="p-2 rounded-lg bg-stone-100 border border-stone-300 cursor-pointer">
              <Search class="w-4 h-4 text-stone-600" />
            </button>
          </div>
          {#if selected}
            <p class="text-xs text-emerald-800">Selected: <span class="font-semibold">{personName(selected)}</span></p>
          {/if}
          {#if isSearching}
            <p class="text-xs text-stone-500">Searching…</p>
          {:else if results.length > 0}
            <ul class="max-h-40 overflow-y-auto space-y-1" aria-label="Search results">
              {#each results as r (r.id)}
                <li>
                  <button
                    type="button"
                    onclick={() => (selected = r)}
                    aria-pressed={selected?.id === r.id}
                    class="w-full text-left px-3 py-2 rounded-lg border text-sm cursor-pointer {selected?.id === r.id ? 'bg-emerald-100 border-emerald-400' : 'bg-white border-stone-200'}"
                  >
                    {personName(r)}
                    {#if r.matchedName}
                      <span class="block text-xs text-stone-500">also known as {r.matchedName}</span>
                    {/if}
                  </button>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="text-xs text-stone-500">Press Enter to search.</p>
          {/if}
        </div>
      {/if}
    {/if}

    {#if kind === 'add_sibling'}
      {#if siblingOptions.length === 0}
        <p class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="sibling-needs-parent">
          {personName(anchor)} has no parents recorded, and a sibling is someone who shares a parent. Add a parent first.
        </p>
      {:else}
        <fieldset class="space-y-1.5" data-testid="sibling-parents">
          <legend class="text-xs font-semibold text-stone-700">Which parents do they share</legend>
          {#each siblingOptions as option (option.key)}
            <label class="flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm {effectiveSiblingKey === option.key ? 'border-emerald-400 bg-emerald-50' : 'border-stone-200 bg-white'}">
              <input type="radio" name="rel-sibling-parents" checked={effectiveSiblingKey === option.key} onchange={() => (siblingOptionKey = option.key)} class="mt-1" />
              <span>
                {option.title}
                <span class="block text-xs text-stone-500">{option.detail}</span>
              </span>
            </label>
          {/each}
        </fieldset>
      {/if}
    {/if}

    {#if showUnionChooser}
      <fieldset class="space-y-1.5" data-testid="union-chooser">
        <legend class="text-xs font-semibold text-stone-700">{unionChooserLegend}</legend>
        {#each unionOptions as option (option.id ?? 'new')}
          <label class="flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm {selectedUnionId === option.id ? 'border-emerald-400 bg-emerald-50' : 'border-stone-200 bg-white'}">
            <input
              type="radio"
              name="rel-union"
              data-union-id={option.id ?? 'new'}
              checked={selectedUnionId === option.id}
              onchange={() => (unionOverride = option.id)}
              class="mt-1"
            />
            <span>
              {option.title}
              <span class="block text-xs text-stone-500">{option.detail}</span>
            </span>
          </label>
        {/each}
        {#if unionOverride === undefined && plan?.unionChoice?.reason}
          <p class="text-xs text-stone-600" data-testid="union-reason">{plan.unionChoice.reason}</p>
        {/if}
      </fieldset>
    {/if}

    {#if kind === 'record_death'}
      <div class="space-y-2">
        <label class="block text-xs font-semibold text-stone-700" for="death-date">Date of death</label>
        <DateInput id="death-date" bind:value={deathDate} placeholder="e.g. 3 MAR 2001, ABT 1900, BET 1950 AND 1955" inputClass="w-full rounded-lg border border-stone-300 bg-white p-2 text-sm" />
        <label class="block text-xs font-semibold text-stone-700" for="death-place">Place of death</label>
        <input id="death-place" type="text" bind:value={deathPlace} class="w-full rounded-lg border border-stone-300 bg-white p-2 text-sm" />
        <p class="text-[11px] text-stone-500">Leave both empty to record only that they have died. A death never ends or changes a partnership.</p>
      </div>
    {/if}

    {#if kind === 'end_union'}
      {#if anchorUnions.length === 0}
        <p class="text-sm text-stone-600">{personName(anchor)} has no partnership to end.</p>
      {:else}
        <fieldset class="space-y-1.5">
          <legend class="text-xs font-semibold text-stone-700">Which partnership</legend>
          {#each anchorUnions as union (union.id)}
            <label class="flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm {effectiveUnionId === union.id ? 'border-emerald-400 bg-emerald-50' : 'border-stone-200 bg-white'}">
              <input type="radio" name="end-union" value={union.id} checked={effectiveUnionId === union.id} onchange={() => (chosenUnionId = union.id)} class="mt-1" />
              <span>
                {partnersLabel(union)}
                <span class="block text-xs text-stone-500">
                  {UNION_STATUS_LABELS[union.status]}{union.marriageDate ? ` · married ${union.marriageDate}` : ''}
                </span>
              </span>
            </label>
          {/each}
        </fieldset>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-semibold text-stone-700" for="end-status">Status</label>
            <select id="end-status" value={endStatus} onchange={(e) => pickStatus(e.currentTarget.value as EndedUnionStatus)} class="w-full rounded-lg border border-stone-300 bg-white p-2 text-sm">
              {#each ENDED_UNION_STATUSES as status (status)}
                <option value={status}>{UNION_STATUS_LABELS[status]}</option>
              {/each}
            </select>
          </div>
          <div>
            <label class="block text-xs font-semibold text-stone-700" for="end-event">Record an event</label>
            <select id="end-event" bind:value={endEventType} class="w-full rounded-lg border border-stone-300 bg-white p-2 text-sm">
              <option value="">No event</option>
              {#each END_EVENT_TYPES as eventType (eventType)}
                <option value={eventType}>{UNION_EVENT_LABELS[eventType]}</option>
              {/each}
            </select>
          </div>
        </div>
        {#if endEventType}
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-semibold text-stone-700" for="end-date">Date</label>
              <DateInput id="end-date" bind:value={endDate} inputClass="w-full rounded-lg border border-stone-300 bg-white p-2 text-sm" />
            </div>
            <div>
              <label class="block text-xs font-semibold text-stone-700" for="end-place">Place</label>
              <input id="end-place" type="text" bind:value={endPlace} class="w-full rounded-lg border border-stone-300 bg-white p-2 text-sm" />
            </div>
          </div>
        {/if}
      {/if}
    {/if}

    <!-- Server preview: the sentence and records the save will write -->
    <div class="min-h-[3rem] rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900" aria-live="polite">
      {#if plan}
        <p class="font-medium">{plan.sentence}</p>
        {#if plan.impact && plan.impact.records.length > 0}
          <ul class="mt-1.5 list-disc space-y-0.5 pl-5 text-xs text-emerald-800">
            {#each plan.impact.records as record (record.entityType + record.entityId)}
              <li>{record.action === 'created' ? 'Adds' : record.action === 'deleted' ? 'Removes' : 'Changes'} {record.label}</li>
            {/each}
          </ul>
        {/if}
        {#if plan.commands.length === 0}
          <p class="mt-1 text-xs font-semibold text-amber-800">Nothing would be saved.</p>
        {/if}
        {#each plan.warnings as w (w.code + w.message)}
          <p class="mt-1 text-xs text-amber-800">{w.message}</p>
        {/each}
      {:else if isPlanning}
        <p class="text-xs text-emerald-800">Checking…</p>
      {:else}
        <p class="text-xs text-emerald-800">The result will be described here before you save.</p>
      {/if}
    </div>

    <div class="flex gap-2">
      <button type="button" onclick={onclose} class="flex-1 py-2 rounded-lg bg-stone-200 text-stone-700 font-semibold cursor-pointer">Cancel</button>
      <button
        type="button"
        onclick={() => submit()}
        disabled={!canSave}
        class="flex-1 py-2 rounded-lg bg-emerald-700 text-white font-semibold cursor-pointer disabled:opacity-50"
      >
        {isSubmitting ? 'Saving…' : 'Save'}
      </button>
    </div>
  </div>
</BaseModal>

<ConflictDialog
  show={conflict !== null}
  subject={kind === 'record_death' ? personName(anchor) : chosenUnion ? `Partnership ${partnersLabel(chosenUnion)}` : ''}
  rows={conflictRows}
  isWorking={isSubmitting}
  onreload={reloadAfterConflict}
  onreapply={reapplyAfterConflict}
  oncancel={() => (conflict = null)}
/>
