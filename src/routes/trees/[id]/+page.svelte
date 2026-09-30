<script lang="ts">
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import PersonDrawer from '#lib/components/tree/PersonDrawer.svelte';
  import TreeCanvas from '#lib/components/tree/TreeCanvas.svelte';
  import TreeToolbar from '#lib/components/tree/TreeToolbar.svelte';
  import { getTreeContext } from '#lib/components/tree/tree-context.js';
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
  import type { PersonPageDto } from '#lib/server/services/person-page-service.js';
  import { fetchPersonPage, recordRecentApi, searchPeopleApi } from '#lib/services/tree-api.js';
  import { EMPTY_LAYOUT, filterParentChildTypes, layoutFocusView } from '#lib/tree-layout/index.js';
  import { rememberedFocusKey } from '#lib/services/load-helpers.js';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
  const { editor, marks } = getTreeContext();
  const historyCoalescer = createHistoryCoalescer();

  const treeId = $derived(page.params.id!);
  /** The address a navigation is heading for, shown before the load commits it; see `navigate`. */
  let pendingSearch = $state<string | null>(null);
  /**
   * The view (focus, depths, toggles, opened stubs) lives in the URL so reloads, back/forward and
   * shared links restore it. Everything below derives from it rather than keeping a second copy.
   */
  const view = $derived(parseViewState(new URLSearchParams(pendingSearch ?? page.url.search)));
  /** What the graph on screen was fetched for. The canvas draws with this, and the toolbar shows `view`. */
  const applied = $derived(data.applied);
  const graph = $derived(data.focusGraph?.graph ?? null);
  /** The graph reaches the tree as a window; the editor's dialogs read versions and names from it. */
  $effect(() => {
    editor.graph = graph;
    return () => (editor.graph = null);
  });

  const focusPersonId = $derived(data.focusGraph?.focusPersonId ?? null);
  const expandedStubIds = $derived(
    graph ? resolveStubTokens(applied.expandedStubs, graph.people.map((p) => p.id), graph.unions.map((u) => u.id)) : []
  );
  const graphForLayout = $derived(graph && view.types.length < ALL_PARENT_CHILD_TYPES.length ? filterParentChildTypes(graph, view.types) : graph);
  const layout = $derived(
    graphForLayout
      ? layoutFocusView(graphForLayout, focusPersonId, {
          ancestorDepth: applied.ancestorDepth,
          descendantDepth: applied.descendantDepth,
          shouldIncludeSiblings: applied.shouldIncludeSiblings,
          shouldIncludeStepFamilies: applied.shouldIncludeStepFamilies,
          expandedStubIds
        })
      : EMPTY_LAYOUT
  );

  /** Re-frame the canvas when this changes. Opening a stub is deliberately not part of it. */
  const viewSignature = $derived(
    JSON.stringify([treeId, focusPersonId, applied.ancestorDepth, applied.descendantDepth, applied.shouldIncludeSiblings, applied.shouldIncludeStepFamilies, view.types])
  );
  /** Bumped when the data reloads without the person having opened a stub, so an edit re-frames the canvas. */
  let dataVersion = $state(0);
  let lastOpenedStubs = '';
  $effect(() => {
    void data.focusGraph;
    const opened = applied.expandedStubs.join(',');
    untrack(() => {
      if (opened === lastOpenedStubs) dataVersion++;
      lastOpenedStubs = opened;
    });
  });
  const fitKey = $derived(`${viewSignature}|${dataVersion}`);

  // Write the resolved focus back into the address so it always describes the view, without a new
  // history entry and without asking the server again.
  $effect(() => {
    const resolved = focusPersonId;
    if (!resolved || page.url.searchParams.get('focus') === resolved) return;
    untrack(() => {
      const query = serializeViewState({ ...parseViewState(page.url.searchParams), treeId: null, focusId: resolved }).toString();
      void goto(query ? `?${query}` : page.url.pathname, { shallow: true, replace: true, state: page.state, reset: false });
    });
  });

  /**
   * Change the URL. `kind` decides the history entry: a new focus always gets one, so Back returns
   * to the previous person, while depth and toggle changes and opened stubs share one entry for as
   * long as the clicks keep coming, so Back undoes a burst of stepper clicks in one go.
   */
  function navigate(change: Partial<TreeViewState>, options: { kind?: HistoryKind } = {}) {
    // Anything but an explicit stub change starts the new view with its stubs closed.
    const stubs = 'expandedStubs' in change ? {} : { expandedStubs: [] };
    const query = serializeViewState({ ...view, treeId: null, focusId: view.focusId ?? focusPersonId, ...stubs, ...change }).toString();
    // The address only changes once the new graph has loaded, so a second click straight after the
    // first would read the old view. Show the new view at once and let the load catch up. Only one
    // navigation runs at a time: a second would cancel the first, and "replace the last entry"
    // would then overwrite the entry the first should have pushed.
    pendingSearch = query ? `?${query}` : '';
    if (isNavigating) queuedNavigation = { query, kind: options.kind };
    else commitNavigation(query, options.kind);
  }

  let isNavigating = false;
  let queuedNavigation: { query: string; kind?: HistoryKind } | null = null;

  function commitNavigation(query: string, kind?: HistoryKind) {
    isNavigating = true;
    void goto(query ? `?${query}` : page.url.pathname, {
      replace: kind ? historyCoalescer.shouldReplace(kind) : false,
      // Leave scroll and the focused element alone; the tree view changes in place.
      reset: false
    }).finally(() => {
      isNavigating = false;
      const next = queuedNavigation;
      queuedNavigation = null;
      if (next) commitNavigation(next.query, next.kind);
      else pendingSearch = null;
    });
  }

  /** Picking someone in the focus box is opening them: it refocuses and counts as a recent. */
  function pickFocus(id: string) {
    navigate({ focusId: id }, { kind: HISTORY_KINDS.FOCUS });
    void recordRecentApi(treeId, id)
      .then((updated) => marks.set(updated))
      .catch(() => {
        // Recents are a convenience; a failed record is not worth a message.
      });
  }

  function setFocus(id: string) {
    try {
      localStorage.setItem(rememberedFocusKey(treeId), id);
    } catch {
      // Remembering the focus is a convenience only.
    }
    navigate({ focusId: id }, { kind: HISTORY_KINDS.FOCUS });
  }

  // ---- The details drawer ----
  let selectedPersonId = $state<string | null>(null);
  let drawerPage = $state<PersonPageDto | null>(null);
  let drawerError = $state<string | null>(null);
  let drawerRequest = 0;

  $effect(() => {
    const id = selectedPersonId;
    // Reload with the tree: an edit, an undo or a new focus all change what the drawer should say.
    void data.focusGraph;
    if (!id) {
      drawerPage = null;
      drawerError = null;
      return;
    }
    const request = ++drawerRequest;
    fetchPersonPage(treeId, id)
      .then((loaded) => {
        if (request !== drawerRequest) return;
        drawerPage = loaded;
        drawerError = null;
      })
      .catch((cause: Error) => {
        if (request !== drawerRequest) return;
        // The person is gone (deleted, or undone away): there is nothing to keep open.
        selectedPersonId = null;
        drawerError = cause.message;
      });
  });

  // Back and forward change the focus; keep an open drawer on the person now at the centre.
  $effect(() => {
    const id = focusPersonId;
    untrack(() => {
      if (id && selectedPersonId && selectedPersonId !== id) selectedPersonId = id;
    });
  });

  function clearSelection() {
    selectedPersonId = null;
  }

  /** Canvas single-click: refocus the chart only. An already-open drawer follows the focus. */
  const handleFocusPerson = (id: string) => setFocus(id);

  /** Canvas double-click or long-press: focus the person and show their details. */
  function handleOpenPerson(id: string) {
    setFocus(id);
    selectedPersonId = id;
  }

  /** From the drawer: clicking the selected person again closes it; the tree stays focused on them. */
  function handleSelectPerson(id: string) {
    if (selectedPersonId === id) {
      clearSelection();
      return;
    }
    setFocus(id);
    selectedPersonId = id;
  }
</script>

<div class="flex-1 min-h-[600px] flex flex-col">
  {#if graph}
    <div class="mb-3">
      <TreeToolbar
        {view}
        searchPeople={(q) => searchPeopleApi(treeId, q)}
        onChange={(change) => navigate(change, { kind: HISTORY_KINDS.ADJUST })}
        onPickFocus={pickFocus}
        suggestions={marks}
      />
    </div>
    <TreeCanvas
      {layout}
      {fitKey}
      selectedPersonId={selectedPersonId}
      onSelectPerson={handleFocusPerson}
      onOpenPerson={handleOpenPerson}
      onClearSelection={clearSelection}
      onEditPerson={(id) => void editor.openEditPerson(id)}
      onDeletePerson={editor.requestDeletePerson}
      onAddRelationship={(anchor) => editor.openRelationship({ id: anchor.id, givenName: anchor.displayName, surname: null })}
      onRemoveLink={editor.removeLink}
      onRecordDeath={(id) => editor.openRelationship(editor.anchorFor(id), { kind: 'record_death' })}
      onEndPartnership={(id) => editor.openRelationship(editor.anchorFor(id), { kind: 'end_union' })}
      onEditUnion={editor.editUnion}
      onEndUnion={editor.endUnion}
      onRemoveAssertion={editor.removeAssertion}
      onChangeLinkType={editor.changeLinkType}
      onRemoveUnion={editor.removeUnion}
      onMergeUnion={editor.mergeUnion}
      mergeableUnionIds={editor.mergeableIds}
      partnershipLabels={editor.unionLabels}
      onDragRelate={editor.dragRelate}
      onExpandStub={(id) => {
        const token = compactStubId(id);
        if (token) navigate({ expandedStubs: [...new Set([...view.expandedStubs, token])] }, { kind: HISTORY_KINDS.ADJUST });
      }}
      onCollapseStub={(id) => {
        const token = compactStubId(id);
        navigate({ expandedStubs: view.expandedStubs.filter((t) => t !== token) }, { kind: HISTORY_KINDS.ADJUST });
      }}
    />
  {:else}
    <div class="flex-1 flex flex-col items-center justify-center rounded-2xl border border-stone-200 bg-stone-100/60 p-10 text-center">
      <p class="text-sm text-stone-700">This tree has no people yet.</p>
      <button
        type="button"
        onclick={editor.openAddPerson}
        class="mt-4 cursor-pointer rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-amber-50 hover:bg-emerald-700"
      >
        Add the first person
      </button>
    </div>
  {/if}
</div>

{#if selectedPersonId}
  <PersonDrawer
    page={drawerPage}
    {treeId}
    error={drawerError}
    onClose={clearSelection}
    onMediaUploaded={editor.refresh}
    onAddRelationship={(id, options) => editor.openRelationship(editor.anchorFor(id), options)}
    onRemoveRelative={editor.requestRelativeAction}
    onEditPerson={(id) => void editor.openEditPerson(id)}
    onDeletePerson={editor.requestDeletePerson}
    onRecordDeath={(id) => editor.openRelationship(editor.anchorFor(id), { kind: 'record_death' })}
    onEditUnion={editor.editUnion}
    onMergeUnion={editor.mergeUnion}
    onSelectPerson={handleSelectPerson}
  />
{/if}
