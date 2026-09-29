<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import TreeCanvas from '#lib/components/tree/TreeCanvas.svelte';
  import TreeToolbar from '#lib/components/tree/TreeToolbar.svelte';
  import {
    ALL_PARENT_CHILD_TYPES,
    HISTORY_KINDS,
    compactStubId,
    createHistoryCoalescer,
    parseViewState,
    resolveStubTokens,
    serializeViewState,
    type HistoryKind,
    type TreeViewState
  } from '#lib/components/tree/tree-url.js';
  import PersonDrawer from '#lib/components/tree/PersonDrawer.svelte';
  import {
    EMPTY_LAYOUT,
    filterParentChildTypes,
    layoutFocusView,
    type ChildAssertion,
    type ChildEdge,
    type PartnerEdge
  } from '#lib/tree-layout/index.js';
  import type { RelationshipGraph } from '#lib/server/domain/relationship-graph.js';
  import AppHeader from '#lib/components/layout/AppHeader.svelte';
  import TreeStatsBanner from '#lib/components/layout/TreeStatsBanner.svelte';
  import NewTreeModal from '#lib/components/modals/NewTreeModal.svelte';
  import PersonModal from '#lib/components/modals/PersonModal.svelte';
  import RelationshipModal from '#lib/components/modals/RelationshipModal.svelte';
  import UnionEditorModal from '#lib/components/modals/UnionEditorModal.svelte';
  import ImpactDialog from '#lib/components/modals/ImpactDialog.svelte';
  import UnionMergeDialog from '#lib/components/modals/UnionMergeDialog.svelte';
  import { mergeCandidatesFor, mergeableUnionIds } from '#lib/components/tree/merge-candidates.js';
  import { partnershipLabels } from '#lib/shared/partnership-labels.js';
  import ConflictDialog from '#lib/components/modals/ConflictDialog.svelte';
  import { differingRows } from '#lib/components/modals/conflict.js';
  import DeleteTreeModal from '#lib/components/modals/DeleteTreeModal.svelte';
  import ImportConfirmModal from '#lib/components/modals/ImportConfirmModal.svelte';
  import ToastHost from '#lib/components/feedback/ToastHost.svelte';
  import { ToastStore, TOAST_TONES } from '#lib/components/feedback/toasts.svelte.js';
  import { RefreshCw, Sparkles } from 'lucide-svelte';
  import type {
    TreeSummary,
    TreeDetails,
    ImportPreviewData,
    PersonFormData,
    ChangeSummary,
    ImpactSummary,
    RelationshipKind
  } from '#lib/types/genealogy.js';
  import {
    fetchTrees,
    fetchTreeDetails,
    createTreeApi,
    deleteTreeApi,
    createIndividualApi,
    updateIndividualApi,
    deleteIndividualApi,
    previewGedcomImport,
    submitGedcomImport,
    fetchRelationshipGraph,
    removeRelationshipApi,
    previewImpactApi,
    previewUnionMergeApi,
    mergeUnionsApi,
    type MergeUnionsRequest,
    searchPeopleApi,
    undoApi,
    isConflict,
    type ConflictError,
    type ImpactRequest,
    type RelationshipDeleteCommand
  } from '#lib/services/tree-api.js';

  let trees = $state<TreeSummary[]>([]);
  let selectedTreeId = $state<string | null>(null);
  let activeTreeData = $state<TreeDetails | null>(null);
  let relationshipGraph = $state<RelationshipGraph | null>(null);
  const toasts = new ToastStore();
  const historyCoalescer = createHistoryCoalescer();
  /**
   * The view (focus, depths, toggles, opened stubs) lives in the URL so reloads, back/forward and
   * shared links restore it. Everything below derives from it rather than keeping a second copy.
   */
  const view = $derived(parseViewState(page.url.searchParams));
  /** The tree is always drawn around one person: the URL's, else the last viewed, else the first. */
  const focusPersonId = $derived(relationshipGraph ? resolveFocus(relationshipGraph, view.focusId) : null);
  /** Re-frame the canvas when this changes. Opening a stub is deliberately not part of it. */
  const viewSignature = $derived(
    JSON.stringify([selectedTreeId, focusPersonId, view.ancestorDepth, view.descendantDepth, view.shouldIncludeSiblings, view.shouldIncludeStepFamilies, view.types])
  );
  const expandedStubIds = $derived(
    relationshipGraph
      ? resolveStubTokens(view.expandedStubs, relationshipGraph.people.map((p) => p.id), relationshipGraph.unions.map((u) => u.id))
      : []
  );
  /** Bumped when the graph is reloaded so the canvas re-frames after an edit. */
  let graphVersion = $state(0);
  const graphForLayout = $derived(
    relationshipGraph && view.types.length < ALL_PARENT_CHILD_TYPES.length
      ? filterParentChildTypes(relationshipGraph, view.types)
      : relationshipGraph
  );
  const neutralLayout = $derived(
    graphForLayout
      ? layoutFocusView(graphForLayout, focusPersonId, {
          ancestorDepth: view.ancestorDepth,
          descendantDepth: view.descendantDepth,
          shouldIncludeSiblings: view.shouldIncludeSiblings,
          shouldIncludeStepFamilies: view.shouldIncludeStepFamilies,
          expandedStubIds
        })
      : EMPTY_LAYOUT
  );
  const fitKey = $derived(`${viewSignature}|${graphVersion}`);

  // Write the resolved tree and focus back into the URL so the address always describes the view.
  $effect(() => {
    if (!relationshipGraph || !selectedTreeId || !focusPersonId) return;
    if (view.treeId === selectedTreeId && view.focusId === focusPersonId) return;
    untrack(() =>
      navigate({ treeId: selectedTreeId, focusId: focusPersonId, expandedStubs: view.expandedStubs }, { isReplace: true })
    );
  });

  // Back/forward changes the focus; keep an open drawer on the person now at the centre.
  $effect(() => {
    const id = focusPersonId;
    untrack(() => {
      if (id && selectedPersonId && selectedPersonId !== id) openDrawerFor(id);
    });
  });

  /**
   * Change the URL. `kind` decides the history entry: a new focus always gets one, so Back returns
   * to the previous person, while depth and toggle changes and opened stubs share one entry for as
   * long as the clicks keep coming, so Back undoes a burst of stepper clicks in one go.
   */
  function navigate(change: Partial<TreeViewState>, options: { isReplace?: boolean; kind?: HistoryKind } = {}) {
    // Anything but an explicit stub change starts the new view with its stubs closed.
    const stubs = 'expandedStubs' in change ? {} : { expandedStubs: [] };
    const query = serializeViewState({ ...view, treeId: selectedTreeId, ...stubs, ...change }).toString();
    const isReplace = options.isReplace ?? (options.kind ? historyCoalescer.shouldReplace(options.kind) : false);
    void goto(query ? `?${query}` : page.url.pathname, {
      replace: isReplace,
      // Leave scroll and the focused element alone; the tree view changes in place.
      reset: false
    });
  }

  let selectedPersonId = $state<string | null>(null);
  let selectedPerson = $state<any | null>(null);

  let loading = $state(false);
  let importStatus = $state<string | null>(null);
  let isImporting = $state(false);

  // New Tree Modal State
  let showNewTreeModal = $state(false);
  let isCreatingTree = $state(false);
  let createTreeError = $state<string | null>(null);

  // Person Modal State (add & edit)
  let showPersonModal = $state(false);
  let personModalMode = $state<'add' | 'edit'>('add');
  let personToEdit = $state<any | null>(null);
  let isSubmittingPerson = $state(false);
  let personModalError = $state<string | null>(null);
  let personConflict = $state<{ error: ConflictError; form: PersonFormData; changes: Partial<PersonFormData>; personId: string } | null>(null);

  // Relationship editor state
  let showRelationshipModal = $state(false);
  let relationshipAnchor = $state<{ id: string; givenName: string | null; surname: string | null } | null>(null);
  let relationshipPreselect = $state<{ id: string; givenName: string | null; surname: string | null } | null>(null);
  let relationshipKind = $state<RelationshipKind>('add_parent');
  let relationshipUnionId = $state<string | null>(null);

  // Union editor state
  let editingUnionId = $state<string | null>(null);
  /** Union whose twins the merge dialog is offering to merge, or null when it is closed. */
  let mergingUnionId = $state<string | null>(null);
  /** "1st partnership", "2nd partnership" for pairs that recur; computed over the whole graph so hidden unions still count. */
  const unionLabels = $derived(relationshipGraph ? partnershipLabels(relationshipGraph.unions) : new Map());
  const mergeableIds = $derived(relationshipGraph ? mergeableUnionIds(relationshipGraph.unions) : new Set<string>());
  const mergeCandidates = $derived(
    relationshipGraph && mergingUnionId ? mergeCandidatesFor(relationshipGraph.unions, mergingUnionId, unionLabels) : []
  );
  const mergePartners = $derived(
    relationshipGraph?.unions.find((u) => u.id === mergingUnionId)?.partnerIds.map((id) => relationshipGraph?.people.find((p) => p.id === id)?.displayName ?? id).join(' and ') ?? ''
  );
  const editingUnion = $derived(relationshipGraph?.unions.find((u) => u.id === editingUnionId) ?? null);

  // Impact (destructive action) dialog state
  interface PendingImpact {
    title: string;
    confirmLabel: string;
    impact: ImpactSummary | null;
    error: string | null;
    isConfirming: boolean;
    /** Toast text when the change comes back without a summary. */
    done: string;
    run: () => Promise<{ change: ChangeSummary | null }>;
  }
  let pendingImpact = $state<PendingImpact | null>(null);

  // Delete Tree Modal State
  let showDeleteTreeModal = $state(false);
  let isDeletingTree = $state(false);
  let deleteTreeError = $state<string | null>(null);

  // Import Modal State
  let showImportConfirmModal = $state(false);
  let pendingImportFile = $state<File | null>(null);
  let importPreview = $state<ImportPreviewData | null>(null);
  let isLoadingPreview = $state(false);
  let isConfirmingImport = $state(false);
  let importConfirmError = $state<string | null>(null);

  onMount(async () => {
    await loadTrees();
  });

  async function loadTrees() {
    try {
      trees = await fetchTrees();
      if (trees.length > 0 && !selectedTreeId) {
        const requested = trees.find((t) => t.id === view.treeId);
        await selectTree((requested ?? trees[0]).id);
      }
    } catch (e) {
      console.error('Failed to load trees', e);
    }
  }

  function focusStorageKey(treeId: string | null): string {
    return `epoch:focus:${treeId}`;
  }

  /** The URL's person if they exist, else the last viewed, else the first in the graph. */
  function resolveFocus(graph: RelationshipGraph, requestedId: string | null): string | null {
    if (requestedId && graph.people.some((p) => p.id === requestedId)) return requestedId;
    try {
      const remembered = localStorage.getItem(focusStorageKey(selectedTreeId));
      if (remembered && graph.people.some((p) => p.id === remembered)) return remembered;
    } catch {
      // Storage can be unavailable (private mode, blocked site data); the default still works.
    }
    return graph.people[0]?.id ?? null;
  }

  function setFocus(id: string) {
    try {
      localStorage.setItem(focusStorageKey(selectedTreeId), id);
    } catch {
      // Remembering the focus is a convenience only.
    }
    navigate({ focusId: id }, { kind: HISTORY_KINDS.FOCUS });
  }

  async function selectTree(id: string, preservePersonId?: string) {
    selectedTreeId = id;
    loading = true;
    relationshipGraph = null;
    if (!preservePersonId) {
      selectedPersonId = null;
      selectedPerson = null;
    }

    try {
      const [data, graph] = await Promise.all([
        fetchTreeDetails(id),
        fetchRelationshipGraph(id)
      ]);
      activeTreeData = data;
      relationshipGraph = graph;
      graphVersion++;
      if (preservePersonId) {
        handleSelectPerson(preservePersonId);
      }
    } catch (e) {
      console.error('Failed to fetch tree details', e);
    } finally {
      loading = false;
    }
  }

  /**
   * Reload the tree's records and graph after a change, without the loading state, keeping the view.
   * Records and graph are fetched together so the versions the editors send are never out of step.
   */
  async function refreshAll() {
    if (!selectedTreeId) return;
    const [data, graph] = await Promise.all([fetchTreeDetails(selectedTreeId), fetchRelationshipGraph(selectedTreeId)]);
    activeTreeData = data;
    relationshipGraph = graph;
    graphVersion++;
    if (selectedPersonId) {
      if (graph.people.some((p) => p.id === selectedPersonId)) openDrawerFor(selectedPersonId);
      else clearSelection();
    }
  }

  /** After a mutation: reload, then say what happened, with Undo when the change can be undone. */
  async function afterChange(change: ChangeSummary | null, fallback: string) {
    await refreshAll();
    toasts.push(change?.summary ?? fallback, {
      action: change?.isUndoable ? { label: 'Undo', run: undoLast } : undefined
    });
  }

  async function undoLast() {
    if (!selectedTreeId) return;
    try {
      const { undone } = await undoApi(selectedTreeId);
      await refreshAll();
      toasts.push(`Undid: ${undone.summary}`);
    } catch (e: any) {
      // Refusals arrive with a plain-language reason (a later change touched the same records).
      toasts.push(e.message || 'Could not undo', { tone: TOAST_TONES.ERROR, durationMs: 10_000 });
    }
  }

  function formatLifeDates(events: any[] | undefined): string {
    if (!events?.length) return '';
    const birth = events.find((e) => e.type === 'BIRT')?.dateRaw;
    const death = events.find((e) => e.type === 'DEAT')?.dateRaw;
    if (birth && death) return `${birth} – ${death}`;
    if (birth) return `b. ${birth}`;
    if (death) return `d. ${death}`;
    return '';
  }

  function handleSelectPerson(id: string) {
    // Clicking the selected person again closes the drawer; the tree stays focused on them.
    if (selectedPersonId === id) {
      clearSelection();
      return;
    }
    setFocus(id);
    openDrawerFor(id);
  }

  function openDrawerFor(id: string) {
    selectedPersonId = id;

    // Prefer the full individual record from the tree details so the drawer and
    // edit modal get sex, names, events, and media. Fall back to the graph's
    // display name when the record is absent.
    const ind = activeTreeData?.individuals?.find((i) => i.id === id);
    if (ind) {
      selectedPerson = {
        id: ind.id,
        name: [ind.givenName, ind.surname].filter(Boolean).join(' ') || ind.id,
        givenName: ind.givenName,
        surname: ind.surname,
        sex: ind.sex,
        dates: formatLifeDates(ind.events),
        raw: ind
      };
    } else if (relationshipGraph) {
      const gp = relationshipGraph.people.find((p) => p.id === id);
      if (gp) {
        selectedPerson = {
          id: gp.id,
          name: gp.displayName,
          sex: 'U',
          dates: '',
          raw: {}
        };
      }
    }
  }

  function clearSelection() {
    selectedPersonId = null;
    selectedPerson = null;
  }

  function handleGedcomFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    pendingImportFile = input.files[0];
    importPreview = null;
    importConfirmError = null;
    input.value = '';
    void openImportConfirm();
  }

  async function openImportConfirm() {
    if (!pendingImportFile) return;
    showImportConfirmModal = true;
    isLoadingPreview = true;
    importConfirmError = null;
    try {
      importPreview = await previewGedcomImport(pendingImportFile, selectedTreeId);
    } catch (err: any) {
      importConfirmError = err.message;
    } finally {
      isLoadingPreview = false;
    }
  }

  async function confirmImport(mode: 'replace' | 'merge', options: { shouldMergeDuplicateFamilies: boolean }) {
    if (!pendingImportFile) return;
    isConfirmingImport = true;
    importConfirmError = null;
    isImporting = true;
    importStatus = 'Importing GEDCOM records into Cloudflare D1...';

    try {
      const resData = await submitGedcomImport(pendingImportFile, mode, selectedTreeId, options);
      importStatus = `Import complete: ${resData.individualsCount || 0} individuals, ${resData.familiesCount || 0} families${resData.mergedFamiliesCount ? ` (${resData.mergedFamiliesCount} duplicate families merged)` : ''}.`;
      showImportConfirmModal = false;
      pendingImportFile = null;
      importPreview = null;
      await loadTrees();
      if (resData.treeId) {
        await selectTree(resData.treeId);
      }
    } catch (err: any) {
      importConfirmError = err.message;
      importStatus = null;
    } finally {
      isConfirmingImport = false;
      isImporting = false;
    }
  }

  function cancelImport() {
    showImportConfirmModal = false;
    pendingImportFile = null;
    importPreview = null;
    importConfirmError = null;
  }

  function openNewTreeModal() {
    createTreeError = null;
    isCreatingTree = false;
    showNewTreeModal = true;
  }

  async function handleCreateTree(data: { name: string; description?: string }) {
    createTreeError = null;
    isCreatingTree = true;
    try {
      const createdTree = await createTreeApi(data);
      showNewTreeModal = false;
      await loadTrees();
      if (createdTree?.id) {
        await selectTree(createdTree.id);
      }
    } catch (e: any) {
      console.error('Failed to create tree', e);
      createTreeError = e?.message || 'Failed to create tree';
    } finally {
      isCreatingTree = false;
    }
  }

  function handleExportGedcom() {
    if (!selectedTreeId) return;
    window.location.href = `/api/export?treeId=${selectedTreeId}`;
  }

  function openAddPersonModal() {
    personModalMode = 'add';
    personToEdit = null;
    personModalError = null;
    isSubmittingPerson = false;
    showPersonModal = true;
  }

  function openEditPersonModal(person: any) {
    if (!person) return;
    personModalMode = 'edit';
    personToEdit = person;
    personModalError = null;
    isSubmittingPerson = false;
    showPersonModal = true;
  }

  /** Resolve a person id to the full individual record, for canvas callbacks. */
  function personRecordById(id: string): any | null {
    const ind = activeTreeData?.individuals?.find((i) => i.id === id);
    if (ind) {
      return {
        id: ind.id,
        name: [ind.givenName, ind.surname].filter(Boolean).join(' ') || ind.id,
        givenName: ind.givenName,
        surname: ind.surname,
        sex: ind.sex,
        raw: ind
      };
    }
    const gp = relationshipGraph?.people.find((p) => p.id === id);
    if (gp) {
      return { id: gp.id, name: gp.displayName, givenName: null, surname: null, sex: gp.sex, raw: {} };
    }
    return null;
  }

  const graphName = (id: string) => relationshipGraph?.people.find((p) => p.id === id)?.displayName ?? id;

  function openRelationship(
    anchor: { id: string; givenName: string | null; surname: string | null },
    options: { kind?: RelationshipKind; unionId?: string | null; preselect?: typeof anchor | null } = {}
  ) {
    relationshipAnchor = anchor;
    relationshipPreselect = options.preselect ?? null;
    relationshipKind = options.kind ?? 'add_parent';
    relationshipUnionId = options.unionId ?? null;
    showRelationshipModal = true;
  }

  function anchorFor(id: string) {
    return { id, givenName: graphName(id), surname: null };
  }

  function handleCanvasAddRelationship(anchor: { id: string; displayName: string }) {
    openRelationship({ id: anchor.id, givenName: anchor.displayName, surname: null });
  }

  function handleCanvasEditPerson(id: string) {
    const rec = personRecordById(id);
    if (rec) openEditPersonModal(rec);
  }

  /**
   * Show exactly what a destructive action would change and only run it once confirmed. The preview
   * is the server's own plan, so the dialog cannot promise something the delete does not do.
   */
  async function confirmWithImpact(options: {
    title: string;
    confirmLabel: string;
    preview: () => Promise<ImpactSummary>;
    run: () => Promise<{ change: ChangeSummary | null }>;
    done: string;
  }) {
    pendingImpact = { title: options.title, confirmLabel: options.confirmLabel, impact: null, error: null, isConfirming: false, done: options.done, run: options.run };
    try {
      const impact = await options.preview();
      if (pendingImpact) pendingImpact.impact = impact;
    } catch (e: any) {
      if (pendingImpact) pendingImpact.error = e.message || 'Could not check what this affects';
    }
  }

  async function runPendingImpact() {
    const pending = pendingImpact;
    if (!pending) return;
    pending.isConfirming = true;
    pending.error = null;
    try {
      const { change } = await pending.run();
      pendingImpact = null;
      await afterChange(change, pending.done);
    } catch (e: any) {
      pending.isConfirming = false;
      if (isConflict(e)) {
        // The thing was changed by someone else after the preview: re-show it rather than delete on stale information.
        pendingImpact = null;
        await refreshAll();
        toasts.push(`${e.message} Nothing was deleted. Review it and try again.`, { tone: TOAST_TONES.ERROR, durationMs: 10_000 });
      } else {
        pending.error = e.message || 'That did not work';
      }
    }
  }

  function requestImpactRemoval(command: RelationshipDeleteCommand, title: string, confirmLabel: string, done: string) {
    if (!selectedTreeId) return;
    const treeId = selectedTreeId;
    void confirmWithImpact({
      title,
      confirmLabel,
      preview: () => previewImpactApi(treeId, command as ImpactRequest),
      run: () => removeRelationshipApi(treeId, command),
      done
    });
  }

  function requestDeletePerson(id: string) {
    if (!selectedTreeId) return;
    const treeId = selectedTreeId;
    const person = relationshipGraph?.people.find((p) => p.id === id);
    void confirmWithImpact({
      title: `Delete ${person?.displayName ?? 'this person'}?`,
      confirmLabel: 'Delete person',
      preview: () => previewImpactApi(treeId, { kind: 'delete_person', personId: id }),
      run: () => deleteIndividualApi(treeId, id, person?.version),
      done: 'Person deleted'
    });
  }

  const unionVersion = (unionId: string) => relationshipGraph?.unions.find((u) => u.id === unionId)?.version;

  function handleRemoveLink(edge: PartnerEdge) {
    requestImpactRemoval(
      { kind: 'remove_partner_from_union', unionId: edge.unionId, personId: edge.personId, expectedVersion: unionVersion(edge.unionId) },
      `Remove ${graphName(edge.personId)} from this partnership?`,
      'Remove partner',
      'Partner removed'
    );
  }

  /** Remove one parent's link from a merged (union, child) edge. */
  function handleRemoveAssertion(edge: ChildEdge, assertion: ChildAssertion) {
    requestImpactRemoval(
      { kind: 'remove_parent_child', parentId: assertion.parentId, childId: edge.childId, type: assertion.type },
      `Remove ${graphName(assertion.parentId)} as a parent of ${graphName(edge.childId)}?`,
      'Remove link',
      'Link removed'
    );
  }

  function handleRemoveUnion(unionId: string) {
    const names = relationshipGraph?.unions.find((u) => u.id === unionId)?.partnerIds.map(graphName).join(' and ');
    requestImpactRemoval(
      { kind: 'destroy_union', unionId, expectedVersion: unionVersion(unionId) },
      `Delete the partnership${names ? ` of ${names}` : ''}?`,
      'Delete partnership',
      'Partnership deleted'
    );
  }

  function handleEditUnion(unionId: string) {
    editingUnionId = unionId;
  }

  function handleMergeUnion(unionId: string) {
    mergingUnionId = unionId;
  }

  async function runMerge(request: MergeUnionsRequest) {
    if (!selectedTreeId) return;
    try {
      const { change } = await mergeUnionsApi(selectedTreeId, request);
      mergingUnionId = null;
      await afterChange(change, 'Partnerships merged');
    } catch (e: any) {
      if (!isConflict(e)) throw e;
      // A partnership changed after the dialog loaded it: show the current state instead of merging on stale information.
      mergingUnionId = null;
      await refreshAll();
      toasts.push(`${e.message} Nothing was merged. Review it and try again.`, { tone: TOAST_TONES.ERROR, durationMs: 10_000 });
    }
  }

  function handleEndUnion(unionId: string) {
    const union = relationshipGraph?.unions.find((u) => u.id === unionId);
    const partnerId = union?.partnerIds[0];
    if (partnerId) openRelationship(anchorFor(partnerId), { kind: 'end_union', unionId });
  }

  function handleDragRelate(relate: { source: { id: string; displayName: string }; target: { id: string; displayName: string } }) {
    // Open the relationship editor anchored on the dragged person, with the
    // drop target pre-selected so the user just confirms the relationship kind.
    openRelationship(
      { id: relate.source.id, givenName: relate.source.displayName, surname: null },
      { preselect: { id: relate.target.id, givenName: relate.target.displayName, surname: null } }
    );
  }

  const PERSON_FIELD_LABELS: Array<[keyof PersonFormData, string]> = [
    ['givenName', 'Given names'],
    ['surname', 'Surname'],
    ['sex', 'Sex'],
    ['birthDate', 'Birth date'],
    ['birthPlace', 'Birth place'],
    ['deathDate', 'Death date'],
    ['deathPlace', 'Death place']
  ];

  /** The person's editable fields as the form shows them, so a submitted form can be compared with them. */
  function formValuesOf(record: any): Record<string, string> {
    const raw = record?.raw ?? {};
    const event = (type: string) => (raw.events ?? []).find((e: any) => e.type === type);
    return {
      givenName: raw.givenName ?? '',
      surname: raw.surname ?? '',
      sex: raw.sex ?? 'U',
      birthDate: event('BIRT')?.dateRaw ?? '',
      birthPlace: event('BIRT')?.place ?? '',
      deathDate: event('DEAT')?.dateRaw ?? '',
      deathPlace: event('DEAT')?.place ?? ''
    };
  }

  /** Only what the person actually changed in the form, so re-applying never overwrites what they did not touch. */
  function changedFields(form: PersonFormData, original: Record<string, string>): Partial<PersonFormData> {
    const changes: Record<string, unknown> = {};
    for (const [key] of PERSON_FIELD_LABELS) {
      const value = (form[key] ?? '') as string;
      if (value !== (original[key] ?? '')) changes[key] = form[key] ?? null;
    }
    return changes as Partial<PersonFormData>;
  }

  /** Rows for the conflict dialog: fields the person changed that now differ from what is stored. */
  const personFormRows = (changes: Partial<PersonFormData>, current: Record<string, any>) =>
    differingRows(
      PERSON_FIELD_LABELS.filter(([key]) => key in changes).map(([key, label]) => ({
        label,
        yours: (changes[key] ?? '') as string,
        current: current[key]
      }))
    );

  async function savePersonEdit(personId: string, formData: Partial<PersonFormData>, version: number) {
    if (!selectedTreeId) return;
    const { change } = await updateIndividualApi(selectedTreeId, personId, formData, version);
    showPersonModal = false;
    personConflict = null;
    await afterChange(change, 'Person saved');
  }

  async function handleSavePerson(formData: PersonFormData) {
    if (!selectedTreeId) return;
    personModalError = null;
    isSubmittingPerson = true;

    try {
      if (personModalMode === 'add') {
        const created = await createIndividualApi(selectedTreeId, formData);
        showPersonModal = false;
        await afterChange(created.change, 'Person added');
        handleSelectPerson(created.id);
      } else if (personModalMode === 'edit' && personToEdit?.id) {
        await savePersonEdit(personToEdit.id, formData, personToEdit.raw?.version ?? 0);
      }
    } catch (err: any) {
      if (isConflict(err) && personToEdit?.id) {
        personConflict = {
          error: err,
          form: formData,
          changes: changedFields(formData, formValuesOf(personToEdit)),
          personId: personToEdit.id
        };
      } else {
        console.error('Failed to save person', err);
        personModalError = err.message || 'Failed to save person';
      }
    } finally {
      isSubmittingPerson = false;
    }
  }

  async function reapplyPersonEdit() {
    const conflict = personConflict;
    if (!conflict) return;
    isSubmittingPerson = true;
    try {
      await savePersonEdit(conflict.personId, conflict.changes, conflict.error.details.currentVersion);
    } catch (err: any) {
      if (isConflict(err)) personConflict = { ...conflict, error: err };
      else {
        personConflict = null;
        personModalError = err.message || 'Failed to save person';
      }
    } finally {
      isSubmittingPerson = false;
    }
  }

  async function reloadPersonEdit() {
    const conflict = personConflict;
    personConflict = null;
    if (!conflict) return;
    await refreshAll();
    // Reopen the form on the stored values so nothing typed is silently kept.
    showPersonModal = false;
    await tick();
    openEditPersonModal(personRecordById(conflict.personId));
  }

  function openRelationshipModal(person: any) {
    if (!person) return;
    openRelationship({
      id: person.id,
      givenName: person.givenName ?? person.raw?.givenName ?? null,
      surname: person.surname ?? person.raw?.surname ?? null
    });
  }

  async function handleRelationshipSaved(change: ChangeSummary | null, plan: { sentence: string; commands: unknown[] }) {
    showRelationshipModal = false;
    await afterChange(change, plan.commands.length === 0 ? 'Nothing was changed' : plan.sentence);
  }

  async function handleUnionSaved(change: ChangeSummary | null) {
    editingUnionId = null;
    await afterChange(change, 'Partnership saved');
  }

  function openDeleteTreeModal() {
    deleteTreeError = null;
    isDeletingTree = false;
    showDeleteTreeModal = true;
  }

  async function handleDeleteTree() {
    if (!selectedTreeId) return;
    isDeletingTree = true;
    deleteTreeError = null;
    try {
      await deleteTreeApi(selectedTreeId);
      showDeleteTreeModal = false;
      selectedTreeId = null;
      activeTreeData = null;
      relationshipGraph = null;
      selectedPersonId = null;
      selectedPerson = null;
      await loadTrees();
      toasts.push('Tree deleted');
    } catch (err: any) {
      deleteTreeError = err.message || 'Failed to delete tree';
    } finally {
      isDeletingTree = false;
    }
  }
</script>

{#snippet treeCanvasSnippet()}
  <div class="flex-1 min-h-[600px] flex flex-col">
    {#if loading}
      <div class="flex-1 flex items-center justify-center bg-stone-100/60 rounded-2xl border border-stone-200">
        <RefreshCw class="w-8 h-8 text-emerald-700 animate-spin" />
      </div>
    {:else}
      {#if relationshipGraph && selectedTreeId}
        {@const treeId = selectedTreeId}
        <div class="mb-3">
          <TreeToolbar
            {view}
            searchPeople={(q) => searchPeopleApi(treeId, q)}
            onChange={(change) => navigate(change, { kind: HISTORY_KINDS.ADJUST })}
            onPickFocus={(id) => navigate({ focusId: id }, { kind: HISTORY_KINDS.FOCUS })}
          />
        </div>
      {/if}
      <TreeCanvas
        layout={neutralLayout}
        {fitKey}
        {selectedPersonId}
        onSelectPerson={handleSelectPerson}
        onClearSelection={clearSelection}
        onEditPerson={handleCanvasEditPerson}
        onDeletePerson={requestDeletePerson}
        onAddRelationship={handleCanvasAddRelationship}
        onRemoveLink={handleRemoveLink}
        onRecordDeath={(id) => openRelationship(anchorFor(id), { kind: 'record_death' })}
        onEndPartnership={(id) => openRelationship(anchorFor(id), { kind: 'end_union' })}
        onEditUnion={handleEditUnion}
        onEndUnion={handleEndUnion}
        onRemoveAssertion={handleRemoveAssertion}
        onRemoveUnion={handleRemoveUnion}
        onMergeUnion={handleMergeUnion}
        mergeableUnionIds={mergeableIds}
        partnershipLabels={unionLabels}
        onDragRelate={handleDragRelate}
        onExpandStub={(id) => {
          const token = compactStubId(id);
          if (token) navigate({ expandedStubs: [...new Set([...view.expandedStubs, token])] }, { kind: HISTORY_KINDS.ADJUST });
        }}
        onCollapseStub={(id) => {
          const token = compactStubId(id);
          navigate({ expandedStubs: view.expandedStubs.filter((t) => t !== token) }, { kind: HISTORY_KINDS.ADJUST });
        }}
      />
    {/if}
  </div>
{/snippet}

{#snippet notificationBannerSnippet(statusText: string)}
  <div class="bg-amber-50/90 border border-amber-300/80 rounded-xl p-3.5 flex items-center justify-between text-xs text-amber-950 shadow-xs">
    <div class="flex items-center space-x-2">
      <Sparkles class="w-4 h-4 text-amber-700 shrink-0" />
      <span class="font-medium">{statusText}</span>
    </div>
    <button
      type="button"
      onclick={() => (importStatus = null)}
      class="text-amber-800 hover:text-amber-950 ml-4 cursor-pointer font-semibold"
    >
      Dismiss
    </button>
  </div>
{/snippet}

<div class="min-h-screen bg-[#fcf9f2] text-stone-800 flex flex-col font-sans">
  <AppHeader
    {trees}
    {selectedTreeId}
    {isImporting}
    onselectTree={(id) => {
      navigate({ treeId: id, focusId: null });
      void selectTree(id);
    }}
    onopenNewTree={openNewTreeModal}
    onopenDeleteTree={openDeleteTreeModal}
    onopenAddPerson={openAddPersonModal}
    onfileSelect={handleGedcomFileSelect}
    onexportGedcom={handleExportGedcom}
  />

  <!-- Main Content Area -->
  <main class="flex-1 p-6 flex flex-col space-y-4 max-w-7xl w-full mx-auto">
    {#if importStatus}
      {@render notificationBannerSnippet(importStatus)}
    {/if}

    {#if activeTreeData}
      <TreeStatsBanner treeData={activeTreeData} />
    {/if}

    {@render treeCanvasSnippet()}
  </main>

  <!-- Person Detail Drawer -->
  {#if selectedPerson && selectedTreeId && relationshipGraph}
    <PersonDrawer
      person={selectedPerson}
      treeId={selectedTreeId}
      graph={relationshipGraph}
      onClose={() => {
        clearSelection();
      }}
      onMediaUploaded={() => {
        if (selectedTreeId) selectTree(selectedTreeId, selectedPersonId || undefined);
      }}
      onAddRelationship={(person) => {
        openRelationshipModal(person);
      }}
      onEditPerson={(person) => {
        openEditPersonModal(person);
      }}
      onDeletePerson={(person) => requestDeletePerson(person.id)}
      onRecordDeath={(person) => openRelationship({ id: person.id, givenName: person.givenName ?? null, surname: person.surname ?? null }, { kind: 'record_death' })}
      onEditUnion={handleEditUnion}
      onEndUnion={handleEndUnion}
      onMergeUnion={handleMergeUnion}
      mergeableUnionIds={mergeableIds}
      partnershipLabels={unionLabels}
      onSelectPerson={(id) => handleSelectPerson(id)}
    />
  {/if}

  <!-- Modals -->
  <NewTreeModal
    show={showNewTreeModal}
    isCreating={isCreatingTree}
    error={createTreeError}
    onclose={() => (showNewTreeModal = false)}
    oncreate={handleCreateTree}
  />

  <PersonModal
    show={showPersonModal}
    mode={personModalMode}
    initialPerson={personToEdit}
    isSubmitting={isSubmittingPerson}
    error={personModalError}
    onclose={() => (showPersonModal = false)}
    onsubmit={handleSavePerson}
  />

  {#if relationshipAnchor && selectedTreeId && relationshipGraph}
    <RelationshipModal
      show={showRelationshipModal}
      treeId={selectedTreeId}
      anchor={relationshipAnchor}
      graph={relationshipGraph}
      preselect={relationshipPreselect}
      initialKind={relationshipKind}
      initialUnionId={relationshipUnionId}
      onclose={() => (showRelationshipModal = false)}
      onsaved={handleRelationshipSaved}
      onrefresh={refreshAll}
    />
  {/if}

  {#if selectedTreeId}
    <UnionEditorModal
      show={editingUnion !== null}
      treeId={selectedTreeId}
      union={editingUnion}
      label={editingUnion ? (unionLabels.get(editingUnion.id) ?? null) : null}
      nameOf={graphName}
      onclose={() => (editingUnionId = null)}
      onsaved={handleUnionSaved}
      onrefresh={refreshAll}
    />
  {/if}

  <ImpactDialog
    show={pendingImpact !== null}
    title={pendingImpact?.title ?? ''}
    impact={pendingImpact?.impact ?? null}
    isLoading={pendingImpact !== null && pendingImpact.impact === null && pendingImpact.error === null}
    isConfirming={pendingImpact?.isConfirming ?? false}
    error={pendingImpact?.error ?? null}
    confirmLabel={pendingImpact?.confirmLabel ?? 'Confirm'}
    onconfirm={runPendingImpact}
    oncancel={() => (pendingImpact = null)}
  />

  {#if selectedTreeId}
    {@const treeId = selectedTreeId}
    <UnionMergeDialog
      show={mergingUnionId !== null && mergeCandidates.length >= 2}
      partners={mergePartners}
      candidates={mergeCandidates}
      onpreview={(request) => previewUnionMergeApi(treeId, request)}
      onconfirm={runMerge}
      oncancel={() => (mergingUnionId = null)}
    />
  {/if}

  <ConflictDialog
    show={personConflict !== null}
    subject={personToEdit?.name ?? ''}
    rows={personConflict ? personFormRows(personConflict.changes, personConflict.error.details.current) : []}
    isWorking={isSubmittingPerson}
    onreload={reloadPersonEdit}
    onreapply={reapplyPersonEdit}
    oncancel={() => (personConflict = null)}
  />

  <ToastHost store={toasts} />

  {#if activeTreeData}
    <DeleteTreeModal
      show={showDeleteTreeModal}
      treeId={activeTreeData.tree.id}
      treeName={activeTreeData.tree?.name || ''}
      isDeleting={isDeletingTree}
      error={deleteTreeError}
      onclose={() => (showDeleteTreeModal = false)}
      ondelete={handleDeleteTree}
    />
  {/if}

  <ImportConfirmModal
    show={showImportConfirmModal}
    treeName={activeTreeData?.tree?.name}
    hasSelectedTree={Boolean(selectedTreeId)}
    preview={importPreview}
    isLoadingPreview={isLoadingPreview}
    isConfirming={isConfirmingImport}
    error={importConfirmError}
    onclose={cancelImport}
    onconfirm={confirmImport}
  />
</div>
