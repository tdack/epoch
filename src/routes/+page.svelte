<script lang="ts">
  import { onMount } from 'svelte';
  import FamilyTreeCanvas from '$lib/components/tree/FamilyTreeCanvas.svelte';
  import PersonDrawer from '$lib/components/tree/PersonDrawer.svelte';
  import { buildFamilyTreeHierarchy, type TreeLayoutResult } from '$lib/components/tree/tree-layout';
  import { Upload, Download, RefreshCw, GitBranch, Plus, Database, Sparkles, UserPlus, Users, Pencil, Trash2 } from 'lucide-svelte';
  import NewTreeModal from '$lib/components/modals/NewTreeModal.svelte';
  import PersonModal from '$lib/components/modals/PersonModal.svelte';
  import FamilyModal from '$lib/components/modals/FamilyModal.svelte';
  import DeleteTreeModal from '$lib/components/modals/DeleteTreeModal.svelte';
  import ImportConfirmModal from '$lib/components/modals/ImportConfirmModal.svelte';
  import type {
    TreeSummary,
    TreeDetails,
    ImportPreviewData,
    PersonFormData,
    FamilyFormData,
    OpenAddFamilyDefaults
  } from '$lib/types/genealogy';
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
  } from '$lib/services/tree-api';

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

  // Delete Tree Modal State
  let showDeleteTreeModal = $state(false);
  let isDeletingTree = $state(false);
  let deleteTreeError = $state<string | null>(null);

  let showImportConfirmModal = $state(false);

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

  let pendingImportFile = $state<File | null>(null);
  let importPreview = $state<ImportPreviewData | null>(null);
  let isLoadingPreview = $state(false);
  let isConfirmingImport = $state(false);
  let importConfirmError = $state<string | null>(null);

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

<div class="min-h-screen bg-[#fcf9f2] text-stone-800 flex flex-col font-sans">
  <!-- Top Navigation Bar -->
  <header class="h-16 border-b border-stone-200/80 bg-[#fdfbf7]/90 backdrop-blur-md px-6 flex items-center justify-between sticky top-0 z-30 shadow-xs">
    <div class="flex items-center space-x-3">
      <div class="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-800 to-emerald-700 flex items-center justify-center shadow-md shadow-emerald-900/15">
        <GitBranch class="w-5 h-5 text-amber-50" />
      </div>
      <div>
        <h1 class="text-base font-bold text-stone-900 tracking-tight">
          Epoch Genealogy
        </h1>
        <p class="text-[10px] text-stone-500 font-medium tracking-wide">Cloudflare D1 &amp; R2 Architecture</p>
      </div>
    </div>

    <!-- Tree Selector & Actions -->
    <div class="flex items-center space-x-3">
      {#if trees.length > 0}
        <select
          value={selectedTreeId}
          onchange={(e) => selectTree(e.currentTarget.value)}
          class="bg-stone-50 text-xs font-medium text-stone-800 border border-stone-300 rounded-lg px-3 py-1.5 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 shadow-xs"
        >
          {#each trees as t}
            <option value={t.id}>{t.name}</option>
          {/each}
        </select>
      {/if}

      <button
        type="button"
        onclick={openNewTreeModal}
        class="inline-flex items-center space-x-1.5 text-xs font-semibold bg-stone-100 hover:bg-stone-200/80 text-stone-800 border border-stone-300 rounded-lg px-3 py-1.5 transition-colors cursor-pointer shadow-xs"
      >
        <Plus class="w-3.5 h-3.5 text-emerald-800" />
        <span>New Tree</span>
      </button>

      {#if selectedTreeId}
        <!-- Delete Tree Action -->
        <button
          type="button"
          onclick={openDeleteTreeModal}
          title="Delete this tree"
          class="inline-flex items-center justify-center text-xs font-semibold bg-stone-100 hover:bg-red-50 text-red-700 border border-stone-300 hover:border-red-300 rounded-lg px-2.5 py-1.5 transition-colors cursor-pointer shadow-xs"
        >
          <Trash2 class="w-3.5 h-3.5" />
        </button>

        <!-- Add Person Action -->
        <button
          type="button"
          onclick={openAddPersonModal}
          class="inline-flex items-center space-x-1.5 text-xs font-semibold bg-emerald-800 hover:bg-emerald-700 text-amber-50 rounded-lg px-3 py-1.5 transition-colors cursor-pointer shadow-sm shadow-emerald-900/15"
        >
          <UserPlus class="w-3.5 h-3.5" />
          <span>Add Person</span>
        </button>

        <!-- Add Family Action -->
        <button
          type="button"
          onclick={() => openAddFamilyModal()}
          class="inline-flex items-center space-x-1.5 text-xs font-semibold bg-amber-800 hover:bg-amber-700 text-amber-50 rounded-lg px-3 py-1.5 transition-colors cursor-pointer shadow-sm shadow-amber-900/15"
        >
          <Users class="w-3.5 h-3.5" />
          <span>Add Family</span>
        </button>
      {/if}

      <!-- Import GEDCOM -->
      <label class="inline-flex items-center space-x-1.5 text-xs font-semibold bg-stone-100 hover:bg-stone-200/80 text-stone-800 border border-stone-300 rounded-lg px-3 py-1.5 transition-colors cursor-pointer shadow-xs">
        <Upload class="w-3.5 h-3.5 text-stone-600" />
        <span>Import GEDCOM</span>
        <input
          type="file"
          accept=".ged,.gedcom"
          onchange={handleGedcomFileSelect}
          class="hidden"
          disabled={isImporting}
        />
      </label>

      <!-- Export GEDCOM -->
      {#if selectedTreeId}
        <button
          type="button"
          onclick={handleExportGedcom}
          class="inline-flex items-center space-x-1.5 text-xs font-semibold bg-stone-100 hover:bg-stone-200/80 text-stone-800 border border-stone-300 rounded-lg px-3 py-1.5 transition-colors cursor-pointer shadow-xs"
        >
          <Download class="w-3.5 h-3.5 text-stone-600" />
          <span>Export 5.5.1</span>
        </button>
      {/if}
    </div>
  </header>

  <!-- Main Content Area -->
  <main class="flex-1 p-6 flex flex-col space-y-4 max-w-7xl w-full mx-auto">
    {#if importStatus}
      <div class="bg-amber-50/90 border border-amber-300/80 rounded-xl p-3.5 flex items-center justify-between text-xs text-amber-950 shadow-xs">
        <div class="flex items-center space-x-2">
          <Sparkles class="w-4 h-4 text-amber-700 shrink-0" />
          <span class="font-medium">{importStatus}</span>
        </div>
        <button
          type="button"
          onclick={() => (importStatus = null)}
          class="text-amber-800 hover:text-amber-950 ml-4 cursor-pointer font-semibold"
        >
          Dismiss
        </button>
      </div>
    {/if}

    <!-- Statistics Banner -->
    {#if activeTreeData}
      <div class="grid grid-cols-3 gap-4">
        <div class="bg-stone-50/90 border border-stone-200 rounded-xl p-4 flex items-center space-x-3.5 shadow-xs">
          <div class="w-10 h-10 rounded-lg bg-emerald-100/70 border border-emerald-300/60 flex items-center justify-center text-emerald-800">
            <Database class="w-5 h-5" />
          </div>
          <div>
            <p class="text-[11px] font-semibold text-stone-500 uppercase tracking-wider">Individuals in D1</p>
            <p class="text-xl font-bold text-stone-900">{activeTreeData.individuals.length}</p>
          </div>
        </div>
        <div class="bg-stone-50/90 border border-stone-200 rounded-xl p-4 flex items-center space-x-3.5 shadow-xs">
          <div class="w-10 h-10 rounded-lg bg-orange-100/80 border border-orange-300/60 flex items-center justify-center text-orange-800">
            <GitBranch class="w-5 h-5" />
          </div>
          <div>
            <p class="text-[11px] font-semibold text-stone-500 uppercase tracking-wider">Families</p>
            <p class="text-xl font-bold text-stone-900">{activeTreeData.families.length}</p>
          </div>
        </div>
        <div class="bg-stone-50/90 border border-stone-200 rounded-xl p-4 flex items-center space-x-3.5 shadow-xs">
          <div class="w-10 h-10 rounded-lg bg-amber-100/80 border border-amber-300/60 flex items-center justify-center text-amber-900">
            <RefreshCw class="w-5 h-5" />
          </div>
          <div class="min-w-0">
            <p class="text-[11px] font-semibold text-stone-500 uppercase tracking-wider">Active Tree</p>
            <p class="text-base font-bold text-stone-900 truncate">{activeTreeData.tree.name}</p>
          </div>
        </div>
      </div>
    {/if}

    <!-- D3 Interactive Hierarchy Canvas -->
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

  <!-- New Tree Modal -->
  <NewTreeModal
    show={showNewTreeModal}
    isCreating={isCreatingTree}
    error={createTreeError}
    onclose={() => (showNewTreeModal = false)}
    oncreate={handleCreateTree}
  />

  <!-- Person Modal (Add / Edit) -->
  <PersonModal
    show={showPersonModal}
    mode={personModalMode}
    initialPerson={personToEdit}
    isSubmitting={isSubmittingPerson}
    error={personModalError}
    onclose={() => (showPersonModal = false)}
    onsubmit={handleSavePerson}
  />

  <!-- Family Modal -->
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

  <!-- Delete Tree Confirmation Modal -->
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

