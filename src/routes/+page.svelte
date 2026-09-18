<script lang="ts">
  import { onMount } from 'svelte';
  import FamilyTreeCanvas from '#lib/components/tree/FamilyTreeCanvas.svelte';
  import PersonDrawer from '#lib/components/tree/PersonDrawer.svelte';
  import { buildFamilyTreeHierarchy, type TreeLayoutResult } from '#lib/components/tree/tree-layout.js';
  import AppHeader from '#lib/components/layout/AppHeader.svelte';
  import TreeStatsBanner from '#lib/components/layout/TreeStatsBanner.svelte';
  import NewTreeModal from '#lib/components/modals/NewTreeModal.svelte';
  import PersonModal from '#lib/components/modals/PersonModal.svelte';
  import FamilyModal from '#lib/components/modals/FamilyModal.svelte';
  import RelationshipModal from '#lib/components/modals/RelationshipModal.svelte';
  import DeleteTreeModal from '#lib/components/modals/DeleteTreeModal.svelte';
  import ImportConfirmModal from '#lib/components/modals/ImportConfirmModal.svelte';
  import { RefreshCw, Sparkles } from 'lucide-svelte';
  import type {
    TreeSummary,
    TreeDetails,
    ImportPreviewData,
    PersonFormData,
    FamilyFormData,
    OpenAddFamilyDefaults
  } from '#lib/types/genealogy.js';
  import {
    fetchTrees,
    fetchTreeDetails,
    createTreeApi,
    deleteTreeApi,
    createIndividualApi,
    updateIndividualApi,
    saveFamilyApi,
    previewGedcomImport,
    submitGedcomImport
  } from '#lib/services/tree-api.js';

  let trees = $state<TreeSummary[]>([]);
  let selectedTreeId = $state<string | null>(null);
  let activeTreeData = $state<TreeDetails | null>(null);
  let treeLayout = $state<TreeLayoutResult>({ nodes: [], unionNodes: [], links: [] });

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

  // Family Modal State
  let showFamilyModal = $state(false);
  let familyModalDefaults = $state<OpenAddFamilyDefaults | undefined>(undefined);
  let isSubmittingFamily = $state(false);
  let familyModalError = $state<string | null>(null);

  // Relationship editor state
  let showRelationshipModal = $state(false);
  let relationshipAnchor = $state<{ id: string; givenName: string | null; surname: string | null } | null>(null);

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
      const data = await fetchTreeDetails(id);
      activeTreeData = data;
      treeLayout = buildFamilyTreeHierarchy(data.individuals || [], data.families || []);
      if (preservePersonId) {
        handleSelectPerson(preservePersonId);
      }
    } catch (e) {
      console.error('Failed to fetch tree details', e);
    } finally {
      loading = false;
    }
  }

  function handleSelectPerson(id: string) {
    selectedPersonId = id;
    const foundNode = treeLayout.nodes.find((n) => n.data.id === id);
    if (foundNode) {
      selectedPerson = foundNode.data;
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

  function openAddFamilyModal(defaults?: OpenAddFamilyDefaults) {
    familyModalError = null;
    isSubmittingFamily = false;
    familyModalDefaults = defaults;
    showFamilyModal = true;
  }

  function openRelationshipModal(person: any) {
    if (!person) return;
    relationshipAnchor = {
      id: person.id,
      givenName: person.givenName ?? person.raw?.givenName ?? null,
      surname: person.surname ?? person.raw?.surname ?? null
    };
    showRelationshipModal = true;
  }

  async function handleRelationshipSaved() {
    if (selectedTreeId) await selectTree(selectedTreeId);
  }

  async function handleSaveFamily(data: FamilyFormData, isEditing: boolean, editingFamilyId: string | null) {
    if (!selectedTreeId) return;
    familyModalError = null;
    isSubmittingFamily = true;

    try {
      await saveFamilyApi(selectedTreeId, data, isEditing ? editingFamilyId : null);
      showFamilyModal = false;
      await selectTree(selectedTreeId);
    } catch (err: any) {
      console.error('Failed to save family', err);
      familyModalError = err.message || 'Failed to save family';
    } finally {
      isSubmittingFamily = false;
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
      treeLayout = { nodes: [], unionNodes: [], links: [] };
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
      <FamilyTreeCanvas
        treeData={treeLayout}
        onSelectPerson={handleSelectPerson}
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
    onopenAddFamily={() => openAddFamilyModal()}
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
  {#if selectedPerson && selectedTreeId}
    <PersonDrawer
      person={selectedPerson}
      treeId={selectedTreeId}
      onClose={() => {
        selectedPersonId = null;
        selectedPerson = null;
      }}
      onMediaUploaded={() => {
        if (selectedTreeId) selectTree(selectedTreeId, selectedPersonId || undefined);
      }}
      onAddFamily={(defaults) => {
        openAddFamilyModal(defaults);
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
      families={activeTreeData?.families || []}
      individuals={activeTreeData?.individuals || []}
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

  <FamilyModal
    show={showFamilyModal}
    individuals={activeTreeData?.individuals || []}
    families={activeTreeData?.families || []}
    defaults={familyModalDefaults}
    isSubmitting={isSubmittingFamily}
    error={familyModalError}
    onclose={() => (showFamilyModal = false)}
    onsubmit={handleSaveFamily}
    onopenAddPerson={() => {
      showFamilyModal = false;
      openAddPersonModal();
    }}
  />

  {#if relationshipAnchor && selectedTreeId}
    <RelationshipModal
      show={showRelationshipModal}
      treeId={selectedTreeId}
      anchor={relationshipAnchor}
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
