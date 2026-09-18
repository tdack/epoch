<script lang="ts">
  import { onMount } from 'svelte';
  import NeutralFamilyTreeCanvas from '#lib/components/tree/NeutralFamilyTreeCanvas.svelte';
  import PersonDrawer from '#lib/components/tree/PersonDrawer.svelte';
  import { buildNeutralGraphLayout, type NeutralGraphLayout } from '#lib/components/tree/neutral-graph-layout.js';
  import type { RelationshipGraph } from '#lib/server/domain/relationship-graph.js';
  import AppHeader from '#lib/components/layout/AppHeader.svelte';
  import TreeStatsBanner from '#lib/components/layout/TreeStatsBanner.svelte';
  import NewTreeModal from '#lib/components/modals/NewTreeModal.svelte';
  import PersonModal from '#lib/components/modals/PersonModal.svelte';
  import RelationshipModal from '#lib/components/modals/RelationshipModal.svelte';
  import DeleteTreeModal from '#lib/components/modals/DeleteTreeModal.svelte';
  import ImportConfirmModal from '#lib/components/modals/ImportConfirmModal.svelte';
  import { RefreshCw, Sparkles } from 'lucide-svelte';
  import type {
    TreeSummary,
    TreeDetails,
    ImportPreviewData,
    PersonFormData
  } from '#lib/types/genealogy.js';
  import {
    fetchTrees,
    fetchTreeDetails,
    createTreeApi,
    deleteTreeApi,
    createIndividualApi,
    updateIndividualApi,
    previewGedcomImport,
    submitGedcomImport,
    fetchRelationshipGraph,
    removeRelationshipApi,
    type RelationshipDeleteCommand
  } from '#lib/services/tree-api.js';

  let trees = $state<TreeSummary[]>([]);
  let selectedTreeId = $state<string | null>(null);
  let activeTreeData = $state<TreeDetails | null>(null);
  let relationshipGraph = $state<RelationshipGraph | null>(null);
  let neutralLayout = $state<NeutralGraphLayout>({ people: [], unions: [], links: [], focusPersonId: null });

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

  // Relationship editor state
  let showRelationshipModal = $state(false);
  let relationshipAnchor = $state<{ id: string; givenName: string | null; surname: string | null } | null>(null);
  let relationshipPreselect = $state<{ id: string; givenName: string | null; surname: string | null } | null>(null);

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
        await selectTree(trees[0].id);
      }
    } catch (e) {
      console.error('Failed to load trees', e);
    }
  }

  async function selectTree(id: string, preservePersonId?: string) {
    selectedTreeId = id;
    loading = true;
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
      neutralLayout = buildNeutralGraphLayout(graph, { focusPersonId: preservePersonId ?? null });
      if (preservePersonId) {
        handleSelectPerson(preservePersonId);
      }
    } catch (e) {
      console.error('Failed to fetch tree details', e);
    } finally {
      loading = false;
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
    // Clicking the already-focused person toggles them off and returns to the
    // full (unfocused) tree, so a user can always deselect.
    if (selectedPersonId === id) {
      clearSelection();
      return;
    }

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

    // Rebuild the neutral layout centred on the newly selected person.
    if (relationshipGraph) {
      neutralLayout = buildNeutralGraphLayout(relationshipGraph, { focusPersonId: id });
    }
  }

  function clearSelection() {
    selectedPersonId = null;
    selectedPerson = null;
    if (relationshipGraph) {
      neutralLayout = buildNeutralGraphLayout(relationshipGraph, { focusPersonId: null });
    }
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

  async function confirmImport(mode: 'replace' | 'merge') {
    if (!pendingImportFile) return;
    isConfirmingImport = true;
    importConfirmError = null;
    isImporting = true;
    importStatus = 'Importing GEDCOM records into Cloudflare D1...';

    try {
      const resData = await submitGedcomImport(pendingImportFile, mode, selectedTreeId);
      importStatus = `Import complete: ${resData.individualsCount || 0} individuals, ${resData.familiesCount || 0} families.`;
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

  async function refreshGraph() {
    if (!selectedTreeId) return;
    const graph = await fetchRelationshipGraph(selectedTreeId);
    relationshipGraph = graph;
    neutralLayout = buildNeutralGraphLayout(graph, { focusPersonId: selectedPersonId ?? null });
    // Keep the drawer selection in sync with the refreshed graph.
    if (selectedPersonId) {
      handleSelectPerson(selectedPersonId);
    }
  }

  async function handleCanvasAddRelationship(anchor: { id: string; displayName: string }) {
    relationshipAnchor = {
      id: anchor.id,
      givenName: anchor.displayName,
      surname: null
    };
    relationshipPreselect = null;
    showRelationshipModal = true;
  }

  async function handleCanvasEditPerson(id: string) {
    const rec = personRecordById(id);
    if (rec) openEditPersonModal(rec);
  }

  async function handleCanvasDeletePerson(id: string) {
    if (!selectedTreeId) return;
    if (!window.confirm('Delete this person? This cannot be undone.')) return;
    try {
      await fetch(`/api/trees/${selectedTreeId}/individuals/${id}`, { method: 'DELETE' });
      await selectTree(selectedTreeId);
    } catch (err: any) {
      window.alert(err.message || 'Failed to delete person');
    }
  }

  async function handleRemoveLink(link: any) {
    if (!selectedTreeId) return;
    let command: RelationshipDeleteCommand;
    if (link.type === 'partner') {
      const personId = link.sourceId;
      command = { kind: 'remove_partner_from_union', unionId: link.unionId, personId };
    } else {
      command = {
        kind: 'remove_parent_child',
        parentId: link.parentId,
        childId: link.childId,
        type: link.relationshipType
      };
    }
    try {
      await removeRelationshipApi(selectedTreeId, command);
      await refreshGraph();
    } catch (err: any) {
      window.alert(err.message || 'Failed to remove relationship');
    }
  }

  async function handleRemoveUnion(unionId: string) {
    if (!selectedTreeId) return;
    if (!window.confirm('Delete this union and its relationship links?')) return;
    try {
      await removeRelationshipApi(selectedTreeId, { kind: 'destroy_union', unionId });
      await refreshGraph();
    } catch (err: any) {
      window.alert(err.message || 'Failed to delete union');
    }
  }

  function handleDragRelate(relate: { source: { id: string; displayName: string }; target: { id: string; displayName: string } }) {
    // Open the relationship editor anchored on the dragged person, with the
    // drop target pre-selected so the user just confirms the relationship kind.
    relationshipAnchor = {
      id: relate.source.id,
      givenName: relate.source.displayName,
      surname: null
    };
    relationshipPreselect = {
      id: relate.target.id,
      givenName: relate.target.displayName,
      surname: null
    };
    showRelationshipModal = true;
  }

  async function handleSavePerson(formData: PersonFormData) {
    if (!selectedTreeId) return;
    personModalError = null;
    isSubmittingPerson = true;

    try {
      if (personModalMode === 'add') {
        const created = await createIndividualApi(selectedTreeId, formData);
        showPersonModal = false;
        await selectTree(selectedTreeId, created.id);
      } else if (personModalMode === 'edit' && personToEdit?.id) {
        const editingId = personToEdit.id;
        await updateIndividualApi(selectedTreeId, editingId, formData);
        showPersonModal = false;
        await selectTree(selectedTreeId, editingId);
      }
    } catch (err: any) {
      console.error('Failed to save person', err);
      personModalError = err.message || 'Failed to save person';
    } finally {
      isSubmittingPerson = false;
    }
  }

  function openRelationshipModal(person: any) {
    if (!person) return;
    relationshipAnchor = {
      id: person.id,
      givenName: person.givenName ?? person.raw?.givenName ?? null,
      surname: person.surname ?? person.raw?.surname ?? null
    };
    relationshipPreselect = null;
    showRelationshipModal = true;
  }

  async function handleRelationshipSaved() {
    if (selectedTreeId) {
      const graph = await fetchRelationshipGraph(selectedTreeId);
      relationshipGraph = graph;
      neutralLayout = buildNeutralGraphLayout(graph, { focusPersonId: selectedPersonId ?? null });
    }
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
      neutralLayout = { people: [], unions: [], links: [], focusPersonId: null };
      selectedPersonId = null;
      selectedPerson = null;
      await loadTrees();
    } catch (err: any) {
      deleteTreeError = err.message || 'Failed to delete tree';
    } finally {
      isDeletingTree = false;
    }
  }

  function handleDeletePerson(_person: any) {
    selectedPersonId = null;
    selectedPerson = null;
    if (selectedTreeId) selectTree(selectedTreeId);
  }
</script>

{#snippet treeCanvasSnippet()}
  <div class="flex-1 min-h-[600px] flex flex-col">
    {#if loading}
      <div class="flex-1 flex items-center justify-center bg-stone-100/60 rounded-2xl border border-stone-200">
        <RefreshCw class="w-8 h-8 text-emerald-700 animate-spin" />
      </div>
    {:else}
      <NeutralFamilyTreeCanvas
        layout={neutralLayout}
        onSelectPerson={handleSelectPerson}
        onEditPerson={handleCanvasEditPerson}
        onDeletePerson={handleCanvasDeletePerson}
        onAddRelationship={handleCanvasAddRelationship}
        onRemoveLink={handleRemoveLink}
        onRemoveUnion={handleRemoveUnion}
        onDragRelate={handleDragRelate}
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
    onselectTree={(id) => selectTree(id)}
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
      onDeletePerson={(person) => {
        handleDeletePerson(person);
      }}
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

  {#if relationshipAnchor && selectedTreeId}
    <RelationshipModal
      show={showRelationshipModal}
      treeId={selectedTreeId}
      anchor={relationshipAnchor}
      preselect={relationshipPreselect}
      onclose={() => (showRelationshipModal = false)}
      onsaved={handleRelationshipSaved}
    />
  {/if}

  {#if activeTreeData}
    <DeleteTreeModal
      show={showDeleteTreeModal}
      treeName={activeTreeData.tree?.name || ''}
      individualsCount={activeTreeData.individuals?.length || 0}
      familiesCount={activeTreeData.families?.length || 0}
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
