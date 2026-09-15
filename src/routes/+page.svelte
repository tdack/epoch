<script lang="ts">
  import { onMount } from 'svelte';
  import FamilyTreeCanvas from '$lib/components/tree/FamilyTreeCanvas.svelte';
  import PersonDrawer from '$lib/components/tree/PersonDrawer.svelte';
  import { buildFamilyTreeHierarchy, type TreeLayoutResult } from '$lib/components/tree/tree-layout';
  import { Upload, Download, RefreshCw, GitBranch, Plus, Database, Sparkles, UserPlus, Users, Pencil, Trash2 } from 'lucide-svelte';

  let trees = $state<Array<{ id: string; name: string; description: string | null }>>([]);
  let selectedTreeId = $state<string | null>(null);
  let activeTreeData = $state<{ tree: any; individuals: any[]; families: any[] } | null>(null);
  let treeLayout = $state<TreeLayoutResult>({ nodes: [], unionNodes: [], links: [] });

  let selectedPersonId = $state<string | null>(null);
  let selectedPerson = $state<any | null>(null);

  let loading = $state(false);
  let importStatus = $state<string | null>(null);
  let isImporting = $state(false);

  // New Tree Modal State
  let showNewTreeModal = $state(false);
  let newTreeName = $state('');
  let newTreeDesc = $state('');
  let isCreatingTree = $state(false);
  let createTreeError = $state<string | null>(null);

  // Add Person Modal State
  let showAddPersonModal = $state(false);
  let isCreatingPerson = $state(false);
  let createPersonError = $state<string | null>(null);
  let personGivenName = $state('');
  let personSurname = $state('');
  let personSex = $state<'M' | 'F' | 'U'>('U');
  let personBirthDate = $state('');
  let personBirthPlace = $state('');
  let personDeathDate = $state('');
  let personDeathPlace = $state('');

  // Edit Person Modal State
  let showEditPersonModal = $state(false);
  let isEditingPerson = $state(false);
  let editingPersonId = $state<string | null>(null);
  let editPersonError = $state<string | null>(null);
  let editGivenName = $state('');
  let editSurname = $state('');
  let editSex = $state<'M' | 'F' | 'U'>('U');
  let editBirthDate = $state('');
  let editBirthPlace = $state('');
  let editDeathDate = $state('');
  let editDeathPlace = $state('');

  // Add/Edit Family Modal State
  let showAddFamilyModal = $state(false);
  let familyModalMode = $state<'editFamily' | 'newFamily' | 'addChild'>('newFamily');
  let isEditingFamily = $state(false);
  let editingFamilyId = $state<string | null>(null);
  let isCreatingFamily = $state(false);
  let createFamilyError = $state<string | null>(null);
  let familyHusbandId = $state<string>('');
  let familyWifeId = $state<string>('');
  let familyChildIds = $state<string[]>([]);
  let familyMarriageDate = $state('');
  let familyMarriagePlace = $state('');
  let familyDivorceDate = $state('');
  let familyDivorcePlace = $state('');
  let familyAnchorPersonId = $state<string | null>(null);

  // Delete Tree Modal State
  let showDeleteTreeModal = $state(false);
  let isDeletingTree = $state(false);
  let deleteTreeError = $state<string | null>(null);
  let deleteTreeConfirmText = $state('');

  let showImportConfirmModal = $state(false);

  onMount(async () => {
    await loadTrees();
  });

  async function loadTrees() {
    try {
      const res = await fetch('/api/trees');
      if (res.ok) {
        const data = (await res.json()) as { trees?: Array<{ id: string; name: string; description: string | null }> };
        trees = data.trees || [];
        if (trees.length > 0 && !selectedTreeId) {
          await selectTree(trees[0].id);
        }
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
      const res = await fetch(`/api/trees/${id}`);
      if (res.ok) {
        const data = (await res.json()) as {
          tree: any;
          individuals: any[];
          families: any[];
        };
        activeTreeData = data;
        treeLayout = buildFamilyTreeHierarchy(data.individuals || [], data.families || []);
        if (preservePersonId) {
          handleSelectPerson(preservePersonId);
        }
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

  // Import confirmation modal state
  interface ImportPreviewData {
    mode: 'replace' | 'merge';
    deleteCounts?: { individuals: number; families: number; events: number; childLinks: number };
    merge?: {
      newIndividuals: number;
      existingIndividuals: number;
      newFamilies: number;
      mergedFamilies: number;
      newChildLinks: number;
      duplicateChildLinks: number;
      newEvents: number;
      duplicateEvents: number;
    };
    incoming: { individuals: number; families: number; events: number };
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
      if (selectedTreeId) {
        // Existing tree: fetch preview from server
        const fd = new FormData();
        fd.append('file', pendingImportFile);
        fd.append('treeId', selectedTreeId);
        const res = await fetch('/api/import', { method: 'PUT', body: fd });
        const data = (await res.json().catch(() => ({}))) as ImportPreviewData & { error?: string };
        if (!res.ok) throw new Error(data.error || 'Failed to preview import');
        importPreview = data;
      } else {
        // New tree: nothing to delete, everything is new
        importPreview = {
          mode: 'replace',
          incoming: { individuals: 0, families: 0, events: 0 }
        };
      }
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

    const fd = new FormData();
    fd.append('file', pendingImportFile);
    fd.append('mode', mode);
    if (selectedTreeId) {
      fd.append('treeId', selectedTreeId);
    }

    try {
      const res = await fetch('/api/import', {
        method: 'POST',
        body: fd
      });

      const resData = (await res.json().catch(() => ({}))) as {
        error?: string;
        individualsCount?: number;
        familiesCount?: number;
        treeId?: string;
      };
      if (!res.ok) throw new Error(resData.error || 'Import failed');

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
    newTreeName = '';
    newTreeDesc = '';
    createTreeError = null;
    isCreatingTree = false;
    showNewTreeModal = true;
  }

  async function createTree() {
    createTreeError = null;
    const trimmedName = newTreeName.trim();
    if (!trimmedName) {
      createTreeError = 'Please enter a name for your tree.';
      return;
    }

    isCreatingTree = true;
    try {
      const res = await fetch('/api/trees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName, description: newTreeDesc.trim() || undefined })
      });

      const data = (await res.json().catch(() => ({}))) as {
        tree?: { id: string; name: string };
        error?: string;
      };

      if (!res.ok) {
        throw new Error(data.error || 'Failed to create tree. Please try again.');
      }

      showNewTreeModal = false;
      newTreeName = '';
      newTreeDesc = '';

      await loadTrees();
      if (data.tree?.id) {
        await selectTree(data.tree.id);
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
    personGivenName = '';
    personSurname = '';
    personSex = 'U';
    personBirthDate = '';
    personBirthPlace = '';
    personDeathDate = '';
    personDeathPlace = '';
    createPersonError = null;
    isCreatingPerson = false;
    showAddPersonModal = true;
  }

  async function createPerson() {
    if (!selectedTreeId) return;
    createPersonError = null;

    if (!personGivenName.trim() && !personSurname.trim()) {
      createPersonError = 'Please provide at least a given name or surname.';
      return;
    }

    isCreatingPerson = true;
    try {
      const res = await fetch(`/api/trees/${selectedTreeId}/individuals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          givenName: personGivenName.trim() || undefined,
          surname: personSurname.trim() || undefined,
          sex: personSex,
          birthDate: personBirthDate.trim() || undefined,
          birthPlace: personBirthPlace.trim() || undefined,
          deathDate: personDeathDate.trim() || undefined,
          deathPlace: personDeathPlace.trim() || undefined
        })
      });

      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        individual?: any;
        error?: string;
      };

      if (!res.ok) {
        throw new Error(data.error || 'Failed to add individual.');
      }

      showAddPersonModal = false;
      await selectTree(selectedTreeId, data.individual?.id);
    } catch (err: any) {
      console.error('Failed to create person', err);
      createPersonError = err.message || 'Failed to create person';
    } finally {
      isCreatingPerson = false;
    }
  }

  function openEditPersonModal(person: any) {
    if (!person) return;
    editingPersonId = person.id;
    editPersonError = null;
    isEditingPerson = false;

    const raw = person.raw || {};
    editGivenName = raw.givenName || '';
    editSurname = raw.surname || '';
    editSex = (person.sex as 'M' | 'F' | 'U') || raw.sex || 'U';

    const events = raw.events || [];
    const birthEvent = events.find((e: any) => e.type === 'BIRT');
    const deathEvent = events.find((e: any) => e.type === 'DEAT');

    editBirthDate = birthEvent?.dateRaw || '';
    editBirthPlace = birthEvent?.place || '';
    editDeathDate = deathEvent?.dateRaw || '';
    editDeathPlace = deathEvent?.place || '';

    showEditPersonModal = true;
  }

  async function updatePerson() {
    if (!selectedTreeId || !editingPersonId) return;
    editPersonError = null;

    if (!editGivenName.trim() && !editSurname.trim()) {
      editPersonError = 'Please provide at least a given name or surname.';
      return;
    }

    isEditingPerson = true;
    try {
      const res = await fetch(`/api/trees/${selectedTreeId}/individuals/${editingPersonId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          givenName: editGivenName.trim() || null,
          surname: editSurname.trim() || null,
          sex: editSex,
          birthDate: editBirthDate.trim() || null,
          birthPlace: editBirthPlace.trim() || null,
          deathDate: editDeathDate.trim() || null,
          deathPlace: editDeathPlace.trim() || null
        })
      });

      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
      };

      if (!res.ok) {
        throw new Error(data.error || 'Failed to update person.');
      }

      showEditPersonModal = false;
      const personIdToRestore = editingPersonId;
      await selectTree(selectedTreeId, personIdToRestore);
    } catch (err: any) {
      console.error('Failed to update person', err);
      editPersonError = err.message || 'Failed to update person';
    } finally {
      isEditingPerson = false;
    }
  }

  function openAddFamilyModal(defaults?: {
    husbandId?: string;
    wifeId?: string;
    childId?: string;
    familyId?: string;
    mode?: 'editFamily' | 'newFamily' | 'addChild';
  }) {
    createFamilyError = null;
    isCreatingFamily = false;
    familyModalMode = defaults?.mode || (defaults?.familyId ? 'editFamily' : 'newFamily');

    // Anchor person ID if launched from a person's drawer
    familyAnchorPersonId = defaults?.husbandId || defaults?.wifeId || null;

    if (familyModalMode === 'addChild') {
      // Adding a child to an individual parent: reuse their existing family
      // (preselecting the partner) instead of creating a duplicate family record.
      const anchorId = defaults?.husbandId || defaults?.wifeId;
      let existingFamily: any = null;
      if (anchorId && activeTreeData?.families) {
        const famsForPerson = activeTreeData.families.filter(
          (f: any) => f.husbandId === anchorId || f.wifeId === anchorId
        );
        existingFamily =
          famsForPerson.find((f: any) => f.husbandId && f.wifeId) || famsForPerson[0] || null;
      }

      if (existingFamily) {
        isEditingFamily = true;
        editingFamilyId = existingFamily.id;
        familyHusbandId = existingFamily.husbandId || '';
        familyWifeId = existingFamily.wifeId || '';
        const existingChildIds = (existingFamily.children || []).map((c: any) => c.childId || c);
        familyChildIds = defaults?.childId && !existingChildIds.includes(defaults.childId)
          ? [...existingChildIds, defaults.childId]
          : existingChildIds;

        const marrEvent = (existingFamily.events || []).find((e: any) => e.type === 'MARR');
        familyMarriageDate = marrEvent?.dateRaw || '';
        familyMarriagePlace = marrEvent?.place || '';
        const divEvent = (existingFamily.events || []).find((e: any) => e.type === 'DIV');
        familyDivorceDate = divEvent?.dateRaw || '';
        familyDivorcePlace = divEvent?.place || '';
      } else {
        // No existing family: allow a single-parent family or a new union.
        isEditingFamily = false;
        editingFamilyId = null;
        familyHusbandId = defaults?.husbandId || '';
        familyWifeId = defaults?.wifeId || '';
        familyChildIds = defaults?.childId ? [defaults.childId] : [];
        familyMarriageDate = '';
        familyMarriagePlace = '';
        familyDivorceDate = '';
        familyDivorcePlace = '';
      }
    } else if (defaults?.familyId && activeTreeData?.families) {
      const targetFamily = activeTreeData.families.find((f: any) => f.id === defaults.familyId);
      if (targetFamily) {
        isEditingFamily = true;
        editingFamilyId = targetFamily.id;
        familyHusbandId = targetFamily.husbandId || '';
        familyWifeId = targetFamily.wifeId || '';
        familyChildIds = (targetFamily.children || []).map((c: any) => c.childId || c);

        const marrEvent = (targetFamily.events || []).find((e: any) => e.type === 'MARR');
        familyMarriageDate = marrEvent?.dateRaw || '';
        familyMarriagePlace = marrEvent?.place || '';
        const divEvent = (targetFamily.events || []).find((e: any) => e.type === 'DIV');
        familyDivorceDate = divEvent?.dateRaw || '';
        familyDivorcePlace = divEvent?.place || '';
      }
    } else if (familyModalMode === 'newFamily') {
      isEditingFamily = false;
      editingFamilyId = null;
      familyHusbandId = defaults?.husbandId || '';
      familyWifeId = defaults?.wifeId || '';
      familyChildIds = defaults?.childId ? [defaults.childId] : [];
      familyMarriageDate = '';
      familyMarriagePlace = '';
      familyDivorceDate = '';
      familyDivorcePlace = '';
    } else {
      // General fallback
      let targetFamily: any = null;
      if (defaults?.husbandId && activeTreeData?.families) {
        targetFamily = activeTreeData.families.find((f: any) => f.husbandId === defaults.husbandId);
      } else if (defaults?.wifeId && activeTreeData?.families) {
        targetFamily = activeTreeData.families.find((f: any) => f.wifeId === defaults.wifeId);
      }

      if (targetFamily) {
        isEditingFamily = true;
        editingFamilyId = targetFamily.id;
        familyHusbandId = targetFamily.husbandId || '';
        familyWifeId = targetFamily.wifeId || '';
        familyChildIds = (targetFamily.children || []).map((c: any) => c.childId || c);

        const marrEvent = (targetFamily.events || []).find((e: any) => e.type === 'MARR');
        familyMarriageDate = marrEvent?.dateRaw || '';
        familyMarriagePlace = marrEvent?.place || '';
        const divEvent = (targetFamily.events || []).find((e: any) => e.type === 'DIV');
        familyDivorceDate = divEvent?.dateRaw || '';
        familyDivorcePlace = divEvent?.place || '';
      } else {
        isEditingFamily = false;
        editingFamilyId = null;
        familyHusbandId = defaults?.husbandId || '';
        familyWifeId = defaults?.wifeId || '';
        familyChildIds = defaults?.childId ? [defaults.childId] : [];
        familyMarriageDate = '';
        familyMarriagePlace = '';
        familyDivorceDate = '';
        familyDivorcePlace = '';
      }
    }

    showAddFamilyModal = true;
  }

  function toggleFamilyChild(id: string) {
    if (familyChildIds.includes(id)) {
      familyChildIds = familyChildIds.filter((cid) => cid !== id);
    } else {
      familyChildIds = [...familyChildIds, id];
    }
  }

  async function saveFamily() {
    if (!selectedTreeId) return;
    createFamilyError = null;

    if (!familyHusbandId && !familyWifeId && familyChildIds.length === 0) {
      createFamilyError = 'Please select at least one parent or child to form a family.';
      return;
    }

    isCreatingFamily = true;
    try {
      const url = isEditingFamily && editingFamilyId
        ? `/api/trees/${selectedTreeId}/families/${editingFamilyId}`
        : `/api/trees/${selectedTreeId}/families`;

      const method = isEditingFamily && editingFamilyId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          husbandId: familyHusbandId || undefined,
          wifeId: familyWifeId || undefined,
          childrenIds: familyChildIds,
          marriageDate: familyMarriageDate.trim() || undefined,
          marriagePlace: familyMarriagePlace.trim() || undefined,
          divorceDate: familyDivorceDate.trim() || undefined,
          divorcePlace: familyDivorcePlace.trim() || undefined
        })
      });

      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        family?: any;
        error?: string;
      };

      if (!res.ok) {
        throw new Error(data.error || `Failed to ${isEditingFamily ? 'update' : 'create'} family.`);
      }

      showAddFamilyModal = false;
      await selectTree(selectedTreeId);
    } catch (err: any) {
      console.error('Failed to save family', err);
      createFamilyError = err.message || 'Failed to save family';
    } finally {
      isCreatingFamily = false;
    }
  }

  async function deleteTree() {
    if (!selectedTreeId || deleteTreeConfirmText !== activeTreeData?.tree?.name) return;
    isDeletingTree = true;
    deleteTreeError = null;
    try {
      const res = await fetch(`/api/trees/${selectedTreeId}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || 'Failed to delete tree');
      }
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
          onclick={() => {
            deleteTreeConfirmText = '';
            deleteTreeError = null;
            showDeleteTreeModal = true;
          }}
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
  {#if showNewTreeModal}
    <div class="fixed inset-0 z-50 bg-stone-950/40 backdrop-blur-xs flex items-center justify-center p-4">
      <form
        onsubmit={(e) => {
          e.preventDefault();
          createTree();
        }}
        class="bg-[#fcfaf5] border border-stone-300/90 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl"
      >
        <div class="flex items-center space-x-2.5">
          <div class="w-7 h-7 rounded-lg bg-emerald-100 border border-emerald-300 flex items-center justify-center text-emerald-800">
            <Plus class="w-4 h-4" />
          </div>
          <h3 class="text-lg font-bold text-stone-900">Create New Genealogy Tree</h3>
        </div>

        {#if createTreeError}
          <div class="bg-orange-50 border border-orange-300 text-orange-900 rounded-lg p-2.5 text-xs font-medium">
            {createTreeError}
          </div>
        {/if}

        <div class="space-y-3.5">
          <div>
            <label for="tree-name-input" class="text-xs font-semibold text-stone-700 block mb-1">
              Tree Name <span class="text-orange-600">*</span>
            </label>
            <input
              id="tree-name-input"
              type="text"
              bind:value={newTreeName}
              placeholder="e.g. Smith Ancestry"
              disabled={isCreatingTree}
              class="w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 disabled:opacity-50"
            />
          </div>
          <div>
            <label for="tree-desc-input" class="text-xs font-semibold text-stone-700 block mb-1">Description (Optional)</label>
            <textarea
              id="tree-desc-input"
              bind:value={newTreeDesc}
              placeholder="Lineage notes or family history details..."
              rows="3"
              disabled={isCreatingTree}
              class="w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 disabled:opacity-50"
            ></textarea>
          </div>
        </div>

        <div class="flex justify-end space-x-2 pt-2 border-t border-stone-200">
          <button
            type="button"
            onclick={() => (showNewTreeModal = false)}
            disabled={isCreatingTree}
            class="px-4 py-2 text-xs font-medium text-stone-600 hover:text-stone-900 rounded-lg hover:bg-stone-200/60 transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isCreatingTree}
            class="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold bg-emerald-800 hover:bg-emerald-700 text-amber-50 rounded-lg transition-colors cursor-pointer shadow-xs disabled:opacity-50"
          >
            {#if isCreatingTree}
              <RefreshCw class="w-3.5 h-3.5 animate-spin mr-1" />
              <span>Creating...</span>
            {:else}
              <span>Create Tree</span>
            {/if}
          </button>
        </div>
      </form>
    </div>
  {/if}

  <!-- Import Confirmation Modal -->
  {#if showImportConfirmModal}
    <div class="fixed inset-0 z-50 bg-stone-950/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div class="bg-[#fcfaf5] border border-stone-300/90 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
        <div class="flex items-center space-x-2.5">
          <div class="w-7 h-7 rounded-lg bg-amber-100 border border-amber-300 flex items-center justify-center text-amber-800">
            <Upload class="w-4 h-4" />
          </div>
          <h3 class="text-lg font-bold text-stone-900">Import GEDCOM</h3>
        </div>

        {#if importConfirmError}
          <div class="bg-orange-50 border border-orange-300 text-orange-900 rounded-lg p-2.5 text-xs font-medium">
            {importConfirmError}
          </div>
        {/if}

        {#if isLoadingPreview}
          <div class="flex items-center space-x-2 text-xs text-stone-600 py-4">
            <RefreshCw class="w-4 h-4 animate-spin" />
            <span>Analysing GEDCOM file against the selected tree...</span>
          </div>
        {:else if importPreview}
          <div class="text-xs text-stone-700 space-y-3">
            <p>
              File contains <strong>{importPreview.incoming.individuals}</strong> people,
              <strong>{importPreview.incoming.families}</strong> families and
              <strong>{importPreview.incoming.events}</strong> events.
            </p>

            {#if !selectedTreeId}
              <div class="bg-stone-100 border border-stone-300 rounded-lg p-3 space-y-1">
                <p class="font-semibold text-stone-900">New tree</p>
                <p>All {importPreview.incoming.individuals} people and {importPreview.incoming.families} families from the file will be imported into a fresh tree.</p>
              </div>
              <button
                type="button"
                onclick={() => confirmImport('replace')}
                disabled={isConfirmingImport}
                class="w-full inline-flex items-center justify-center space-x-1.5 px-4 py-2 text-xs font-semibold bg-emerald-800 hover:bg-emerald-700 text-amber-50 rounded-lg transition-colors cursor-pointer shadow-xs disabled:opacity-50"
              >
                {#if isConfirmingImport}
                  <RefreshCw class="w-3.5 h-3.5 animate-spin" />
                  <span>Importing...</span>
                {:else}
                  <span>Import into new tree</span>
                {/if}
              </button>
            {:else if importPreview.mode === 'replace' && importPreview.deleteCounts}
              <div class="bg-red-50 border border-red-300 rounded-lg p-3 space-y-1">
                <p class="font-semibold text-red-900">Replace — destructive</p>
                <p>
                  <strong>{importPreview.deleteCounts.individuals}</strong> people,
                  <strong>{importPreview.deleteCounts.families}</strong> families and
                  <strong>{importPreview.deleteCounts.events}</strong> events in
                  “{activeTreeData?.tree?.name ?? 'this tree'}” will be <strong>permanently deleted</strong>
                  and replaced by {importPreview.incoming.individuals} people and
                  {importPreview.incoming.families} families from the file.
                </p>
              </div>
              <div class="flex space-x-2">
                <button
                  type="button"
                  onclick={() => confirmImport('merge')}
                  disabled={isConfirmingImport}
                  class="flex-1 px-4 py-2 text-xs font-semibold text-stone-700 border border-stone-300 hover:bg-stone-200/60 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                >
                  Merge instead
                </button>
                <button
                  type="button"
                  onclick={() => confirmImport('replace')}
                  disabled={isConfirmingImport}
                  class="flex-1 inline-flex items-center justify-center space-x-1.5 px-4 py-2 text-xs font-semibold bg-red-800 hover:bg-red-700 text-red-50 rounded-lg transition-colors cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {#if isConfirmingImport}
                    <RefreshCw class="w-3.5 h-3.5 animate-spin" />
                    <span>Replacing...</span>
                  {:else}
                    <span>Delete &amp; replace</span>
                  {/if}
                </button>
              </div>
            {:else if importPreview.merge}
              <div class="bg-emerald-50 border border-emerald-300 rounded-lg p-3 space-y-1.5">
                <p class="font-semibold text-emerald-900">Merge — changes preview</p>
                <ul class="space-y-0.5 list-disc list-inside text-stone-800">
                  <li>{importPreview.merge.newIndividuals} new people ({importPreview.merge.existingIndividuals} already exist and will be kept)</li>
                  <li>{importPreview.merge.newFamilies} new families; {importPreview.merge.mergedFamilies} duplicate families will be merged into existing ones</li>
                  <li>{importPreview.merge.newChildLinks} new child links ({importPreview.merge.duplicateChildLinks} duplicates skipped)</li>
                  <li>{importPreview.merge.newEvents} new events ({importPreview.merge.duplicateEvents} duplicates skipped)</li>
                </ul>
                {#if importPreview.deleteCounts}
                  <p class="text-stone-600">
                    Alternatively, replace would delete {importPreview.deleteCounts.individuals} people,
                    {importPreview.deleteCounts.families} families and {importPreview.deleteCounts.events} events
                    and rebuild the tree from the file.
                  </p>
                {/if}
              </div>
              <div class="flex space-x-2">
                <button
                  type="button"
                  onclick={cancelImport}
                  disabled={isConfirmingImport}
                  class="flex-1 px-4 py-2 text-xs font-medium text-stone-600 hover:text-stone-900 rounded-lg hover:bg-stone-200/60 transition-colors cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                {#if importPreview.deleteCounts}
                  <button
                    type="button"
                    onclick={() => confirmImport('replace')}
                    disabled={isConfirmingImport}
                    class="flex-1 px-4 py-2 text-xs font-semibold bg-red-800 hover:bg-red-700 text-red-50 rounded-lg transition-colors cursor-pointer shadow-xs disabled:opacity-50"
                  >
                    Delete &amp; replace
                  </button>
                {/if}
                <button
                  type="button"
                  onclick={() => confirmImport('merge')}
                  disabled={isConfirmingImport}
                  class="flex-1 inline-flex items-center justify-center space-x-1.5 px-4 py-2 text-xs font-semibold bg-emerald-800 hover:bg-emerald-700 text-amber-50 rounded-lg transition-colors cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {#if isConfirmingImport}
                    <RefreshCw class="w-3.5 h-3.5 animate-spin" />
                    <span>Merging...</span>
                  {:else}
                    <span>Merge into tree</span>
                  {/if}
                </button>
              </div>
            {/if}
          </div>
        {/if}

        {#if !isLoadingPreview && selectedTreeId}
          <button
            type="button"
            onclick={cancelImport}
            disabled={isConfirmingImport}
            class="w-full text-center text-xs text-stone-500 hover:text-stone-800 transition-colors cursor-pointer"
          >
            Cancel import
          </button>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Add Person Modal -->
  {#if showAddPersonModal}
    <div class="fixed inset-0 z-50 bg-stone-950/40 backdrop-blur-xs flex items-center justify-center p-4">
      <form
        onsubmit={(e) => {
          e.preventDefault();
          createPerson();
        }}
        class="bg-[#fcfaf5] border border-stone-300/90 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-2xl overflow-y-auto max-h-[90vh]"
      >
        <div class="flex items-center space-x-2.5">
          <div class="w-7 h-7 rounded-lg bg-emerald-100 border border-emerald-300 flex items-center justify-center text-emerald-800">
            <UserPlus class="w-4 h-4" />
          </div>
          <h3 class="text-lg font-bold text-stone-900">Add Individual</h3>
        </div>

        {#if createPersonError}
          <div class="bg-orange-50 border border-orange-300 text-orange-900 rounded-lg p-2.5 text-xs font-medium">
            {createPersonError}
          </div>
        {/if}

        <div class="space-y-4">
          <!-- Names -->
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label for="person-given-name" class="text-xs font-semibold text-stone-700 block mb-1">Given Names</label>
              <input
                id="person-given-name"
                type="text"
                bind:value={personGivenName}
                placeholder="e.g. John Edward"
                disabled={isCreatingPerson}
                class="w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 disabled:opacity-50"
              />
            </div>
            <div>
              <label for="person-surname" class="text-xs font-semibold text-stone-700 block mb-1">Surname</label>
              <input
                id="person-surname"
                type="text"
                bind:value={personSurname}
                placeholder="e.g. Smith"
                disabled={isCreatingPerson}
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
                  name="sex"
                  value="M"
                  bind:group={personSex}
                  disabled={isCreatingPerson}
                  class="text-emerald-800 focus:ring-emerald-600 mr-1.5"
                />
                Male
              </label>
              <label class="inline-flex items-center text-xs text-stone-700 cursor-pointer">
                <input
                  type="radio"
                  name="sex"
                  value="F"
                  bind:group={personSex}
                  disabled={isCreatingPerson}
                  class="text-emerald-800 focus:ring-emerald-600 mr-1.5"
                />
                Female
              </label>
              <label class="inline-flex items-center text-xs text-stone-700 cursor-pointer">
                <input
                  type="radio"
                  name="sex"
                  value="U"
                  bind:group={personSex}
                  disabled={isCreatingPerson}
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
                <label for="person-birth-date" class="text-xs font-medium text-stone-600 block mb-1">Birth Date</label>
                <input
                  id="person-birth-date"
                  type="text"
                  bind:value={personBirthDate}
                  placeholder="e.g. 14 APR 1912"
                  disabled={isCreatingPerson}
                  class="w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-1.5 text-xs text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 disabled:opacity-50"
                />
              </div>
              <div>
                <label for="person-birth-place" class="text-xs font-medium text-stone-600 block mb-1">Birth Place</label>
                <input
                  id="person-birth-place"
                  type="text"
                  bind:value={personBirthPlace}
                  placeholder="e.g. Southampton, England"
                  disabled={isCreatingPerson}
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
                <label for="person-death-date" class="text-xs font-medium text-stone-600 block mb-1">Death Date</label>
                <input
                  id="person-death-date"
                  type="text"
                  bind:value={personDeathDate}
                  placeholder="e.g. 23 OCT 1985"
                  disabled={isCreatingPerson}
                  class="w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-1.5 text-xs text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 disabled:opacity-50"
                />
              </div>
              <div>
                <label for="person-death-place" class="text-xs font-medium text-stone-600 block mb-1">Death Place</label>
                <input
                  id="person-death-place"
                  type="text"
                  bind:value={personDeathPlace}
                  placeholder="e.g. New York, USA"
                  disabled={isCreatingPerson}
                  class="w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-1.5 text-xs text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 disabled:opacity-50"
                />
              </div>
            </div>
          </div>
        </div>

        <div class="flex justify-end space-x-2 pt-3 border-t border-stone-200">
          <button
            type="button"
            onclick={() => (showAddPersonModal = false)}
            disabled={isCreatingPerson}
            class="px-4 py-2 text-xs font-medium text-stone-600 hover:text-stone-900 rounded-lg hover:bg-stone-200/60 transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isCreatingPerson}
            class="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold bg-emerald-800 hover:bg-emerald-700 text-amber-50 rounded-lg transition-colors cursor-pointer shadow-xs disabled:opacity-50"
          >
            {#if isCreatingPerson}
              <RefreshCw class="w-3.5 h-3.5 animate-spin mr-1" />
              <span>Saving...</span>
            {:else}
              <span>Add Person</span>
            {/if}
          </button>
        </div>
      </form>
    </div>
  {/if}

  <!-- Edit Person Modal -->
  {#if showEditPersonModal}
    <div class="fixed inset-0 z-50 bg-stone-950/40 backdrop-blur-xs flex items-center justify-center p-4">
      <form
        onsubmit={(e) => {
          e.preventDefault();
          updatePerson();
        }}
        class="bg-[#fcfaf5] border border-stone-300/90 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl"
      >
        <div class="flex items-center space-x-2.5">
          <div class="w-7 h-7 rounded-lg bg-emerald-100 border border-emerald-300 flex items-center justify-center text-emerald-800">
            <Pencil class="w-4 h-4" />
          </div>
          <h3 class="text-lg font-bold text-stone-900">Edit Person Details</h3>
        </div>

        {#if editPersonError}
          <div class="bg-orange-50 border border-orange-300 text-orange-900 rounded-lg p-2.5 text-xs font-medium">
            {editPersonError}
          </div>
        {/if}

        <div class="space-y-3.5">
          <!-- Name Fields -->
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label for="edit-person-given-name" class="text-xs font-semibold text-stone-700 block mb-1">Given Name</label>
              <input
                id="edit-person-given-name"
                type="text"
                bind:value={editGivenName}
                placeholder="e.g. John"
                disabled={isEditingPerson}
                class="w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 disabled:opacity-50"
              />
            </div>
            <div>
              <label for="edit-person-surname" class="text-xs font-semibold text-stone-700 block mb-1">Surname</label>
              <input
                id="edit-person-surname"
                type="text"
                bind:value={editSurname}
                placeholder="e.g. Smith"
                disabled={isEditingPerson}
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
                  name="edit-sex"
                  value="M"
                  bind:group={editSex}
                  disabled={isEditingPerson}
                  class="text-emerald-800 focus:ring-emerald-600 mr-1.5"
                />
                Male
              </label>
              <label class="inline-flex items-center text-xs text-stone-700 cursor-pointer">
                <input
                  type="radio"
                  name="edit-sex"
                  value="F"
                  bind:group={editSex}
                  disabled={isEditingPerson}
                  class="text-emerald-800 focus:ring-emerald-600 mr-1.5"
                />
                Female
              </label>
              <label class="inline-flex items-center text-xs text-stone-700 cursor-pointer">
                <input
                  type="radio"
                  name="edit-sex"
                  value="U"
                  bind:group={editSex}
                  disabled={isEditingPerson}
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
                <label for="edit-person-birth-date" class="text-xs font-medium text-stone-600 block mb-1">Birth Date</label>
                <input
                  id="edit-person-birth-date"
                  type="text"
                  bind:value={editBirthDate}
                  placeholder="e.g. 14 APR 1912"
                  disabled={isEditingPerson}
                  class="w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-1.5 text-xs text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 disabled:opacity-50"
                />
              </div>
              <div>
                <label for="edit-person-birth-place" class="text-xs font-medium text-stone-600 block mb-1">Birth Place</label>
                <input
                  id="edit-person-birth-place"
                  type="text"
                  bind:value={editBirthPlace}
                  placeholder="e.g. Southampton, England"
                  disabled={isEditingPerson}
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
                <label for="edit-person-death-date" class="text-xs font-medium text-stone-600 block mb-1">Death Date</label>
                <input
                  id="edit-person-death-date"
                  type="text"
                  bind:value={editDeathDate}
                  placeholder="e.g. 23 OCT 1985"
                  disabled={isEditingPerson}
                  class="w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-1.5 text-xs text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 disabled:opacity-50"
                />
              </div>
              <div>
                <label for="edit-person-death-place" class="text-xs font-medium text-stone-600 block mb-1">Death Place</label>
                <input
                  id="edit-person-death-place"
                  type="text"
                  bind:value={editDeathPlace}
                  placeholder="e.g. New York, USA"
                  disabled={isEditingPerson}
                  class="w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-1.5 text-xs text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 disabled:opacity-50"
                />
              </div>
            </div>
          </div>
        </div>

        <div class="flex justify-end space-x-2 pt-3 border-t border-stone-200">
          <button
            type="button"
            onclick={() => (showEditPersonModal = false)}
            disabled={isEditingPerson}
            class="px-4 py-2 text-xs font-medium text-stone-600 hover:text-stone-900 rounded-lg hover:bg-stone-200/60 transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isEditingPerson}
            class="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold bg-emerald-800 hover:bg-emerald-700 text-amber-50 rounded-lg transition-colors cursor-pointer shadow-xs disabled:opacity-50"
          >
            {#if isEditingPerson}
              <RefreshCw class="w-3.5 h-3.5 animate-spin mr-1" />
              <span>Saving...</span>
            {:else}
              <span>Save Changes</span>
            {/if}
          </button>
        </div>
      </form>
    </div>
  {/if}

  <!-- Add Family Modal -->
  {#if showAddFamilyModal}
    <div class="fixed inset-0 z-50 bg-stone-950/40 backdrop-blur-xs flex items-center justify-center p-4">
      <form
        onsubmit={(e) => {
          e.preventDefault();
          saveFamily();
        }}
        class="bg-[#fcfaf5] border border-stone-300/90 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-2xl overflow-y-auto max-h-[90vh]"
      >
        <div class="flex items-center space-x-2.5">
          <div class="w-7 h-7 rounded-lg bg-amber-100 border border-amber-300 flex items-center justify-center text-amber-800">
            <Users class="w-4 h-4" />
          </div>
          <div>
            <h3 class="text-lg font-bold text-stone-900">
              {familyModalMode === 'addChild' ? 'Add Children to Family' : isEditingFamily ? 'Edit Family Union' : 'Add Family Union'}
            </h3>
            {#if familyModalMode === 'addChild'}
              <p class="text-[11px] text-stone-500">
                Choose the co-parent partner or leave as "None / Single Parent".
              </p>
            {/if}
          </div>
        </div>

        {#if createFamilyError}
          <div class="bg-orange-50 border border-orange-300 text-orange-900 rounded-lg p-2.5 text-xs font-medium">
            {createFamilyError}
          </div>
        {/if}

        <div class="space-y-4">
          {#if familyModalMode === 'addChild' && familyAnchorPersonId}
            {@const anchorInd = activeTreeData?.individuals?.find((i: any) => i.id === familyAnchorPersonId)}
            {@const anchorName = anchorInd ? [anchorInd.givenName, anchorInd.surname].filter(Boolean).join(' ') || anchorInd.id : 'Selected Parent'}
            <div class="bg-amber-100/60 border border-amber-300/80 rounded-xl p-3 text-xs text-amber-900 space-y-1">
              <span class="font-bold block">Adding child for: {anchorName}</span>
              <p class="text-stone-600 text-[11px]">
                You can select a partner below to associate the child with both parents, or leave the partner as <em>None / Unknown</em> for a single-parent family.
              </p>
            </div>
          {/if}

          <!-- Spouses / Partners -->
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label for="family-husband" class="text-xs font-semibold text-stone-700 block mb-1">Husband / Partner 1</label>
              <select
                id="family-husband"
                bind:value={familyHusbandId}
                disabled={isCreatingFamily}
                class="w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-2 text-xs text-stone-900 focus:outline-none focus:border-amber-600 focus:ring-1 focus:ring-amber-600 disabled:opacity-50"
              >
                <option value="">None / Unknown</option>
                {#each activeTreeData?.individuals || [] as ind}
                  <option value={ind.id}>
                    {[ind.givenName, ind.surname].filter(Boolean).join(' ') || ind.id} ({ind.sex || '?'})
                  </option>
                {/each}
              </select>
            </div>
            <div>
              <label for="family-wife" class="text-xs font-semibold text-stone-700 block mb-1">Wife / Partner 2</label>
              <select
                id="family-wife"
                bind:value={familyWifeId}
                disabled={isCreatingFamily}
                class="w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-2 text-xs text-stone-900 focus:outline-none focus:border-amber-600 focus:ring-1 focus:ring-amber-600 disabled:opacity-50"
              >
                <option value="">None / Unknown</option>
                {#each activeTreeData?.individuals || [] as ind}
                  <option value={ind.id}>
                    {[ind.givenName, ind.surname].filter(Boolean).join(' ') || ind.id} ({ind.sex || '?'})
                  </option>
                {/each}
              </select>
            </div>
          </div>

          <!-- Marriage Event -->
          <div class="border-t border-stone-200 pt-3">
            <h4 class="text-xs font-bold uppercase tracking-wider text-stone-600 mb-2">Marriage / Union Event</h4>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label for="marriage-date" class="text-xs font-medium text-stone-600 block mb-1">Marriage Date</label>
                <input
                  id="marriage-date"
                  type="text"
                  bind:value={familyMarriageDate}
                  placeholder="e.g. 12 JUN 1940"
                  disabled={isCreatingFamily}
                  class="w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-1.5 text-xs text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-amber-600 focus:ring-1 focus:ring-amber-600 disabled:opacity-50"
                />
              </div>
              <div>
                <label for="marriage-place" class="text-xs font-medium text-stone-600 block mb-1">Marriage Place</label>
                <input
                  id="marriage-place"
                  type="text"
                  bind:value={familyMarriagePlace}
                  placeholder="e.g. Edinburgh, Scotland"
                  disabled={isCreatingFamily}
                  class="w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-1.5 text-xs text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-amber-600 focus:ring-1 focus:ring-amber-600 disabled:opacity-50"
                />
              </div>
            </div>
          </div>

          <!-- Divorce / Separation Event -->
          {#if isEditingFamily}
            <div class="border-t border-stone-200 pt-3">
              <h4 class="text-xs font-bold uppercase tracking-wider text-stone-600 mb-2">Divorce / Separation</h4>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label for="divorce-date" class="text-xs font-medium text-stone-600 block mb-1">Divorce Date</label>
                  <input
                    id="divorce-date"
                    type="text"
                    bind:value={familyDivorceDate}
                    placeholder="e.g. 3 SEP 1985 (leave blank if none)"
                    disabled={isCreatingFamily}
                    class="w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-1.5 text-xs text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-amber-600 focus:ring-1 focus:ring-amber-600 disabled:opacity-50"
                  />
                </div>
                <div>
                  <label for="divorce-place" class="text-xs font-medium text-stone-600 block mb-1">Place</label>
                  <input
                    id="divorce-place"
                    type="text"
                    bind:value={familyDivorcePlace}
                    placeholder="e.g. Adelaide, Australia"
                    disabled={isCreatingFamily}
                    class="w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-1.5 text-xs text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-amber-600 focus:ring-1 focus:ring-amber-600 disabled:opacity-50"
                  />
                </div>
              </div>
              <p class="text-[11px] text-stone-500 mt-1.5">Clearing both fields removes the divorce record. For remarriage, use "New Marriage / Partner" in a person's drawer to create a second union.</p>
            </div>
          {/if}

          <!-- Children Selection -->
          <div class="border-t border-stone-200 pt-3">
            <div class="flex items-center justify-between mb-2">
              <h4 class="text-xs font-bold uppercase tracking-wider text-stone-600">
                Link Children ({familyChildIds.length} selected)
              </h4>
              <button
                type="button"
                onclick={() => {
                  showAddFamilyModal = false;
                  openAddPersonModal();
                }}
                class="text-[11px] font-medium text-emerald-800 hover:text-emerald-950 underline cursor-pointer"
              >
                + New Individual
              </button>
            </div>
            <div class="max-h-40 overflow-y-auto space-y-1.5 border border-stone-200 rounded-lg p-2.5 bg-stone-50/70">
              {#if !activeTreeData?.individuals || activeTreeData.individuals.length === 0}
                <p class="text-xs text-stone-500 italic">No individuals available in this tree</p>
              {:else}
                {#each activeTreeData.individuals as ind}
                  {#if ind.id !== familyHusbandId && ind.id !== familyWifeId}
                    <label class="flex items-center space-x-2 text-xs text-stone-700 hover:bg-stone-200/50 p-1.5 rounded-md cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={familyChildIds.includes(ind.id)}
                        onchange={() => toggleFamilyChild(ind.id)}
                        disabled={isCreatingFamily}
                        class="text-amber-800 rounded-sm focus:ring-amber-600"
                      />
                      <span class="font-medium">{[ind.givenName, ind.surname].filter(Boolean).join(' ') || ind.id}</span>
                      <span class="text-stone-400 text-[10px]">({ind.sex || '?'})</span>
                    </label>
                  {/if}
                {/each}
              {/if}
            </div>
          </div>
        </div>

        <div class="flex justify-end space-x-2 pt-3 border-t border-stone-200">
          <button
            type="button"
            onclick={() => (showAddFamilyModal = false)}
            disabled={isCreatingFamily}
            class="px-4 py-2 text-xs font-medium text-stone-600 hover:text-stone-900 rounded-lg hover:bg-stone-200/60 transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isCreatingFamily}
            class="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold bg-amber-800 hover:bg-amber-700 text-amber-50 rounded-lg transition-colors cursor-pointer shadow-xs disabled:opacity-50"
          >
            {#if isCreatingFamily}
              <RefreshCw class="w-3.5 h-3.5 animate-spin mr-1" />
              <span>Saving...</span>
            {:else}
              <span>{isEditingFamily ? 'Update Family' : 'Create Family'}</span>
            {/if}
          </button>
        </div>
      </form>
    </div>
  {/if}

  <!-- Delete Tree Confirmation Modal -->
  {#if showDeleteTreeModal && activeTreeData}
    <div class="fixed inset-0 z-50 bg-stone-950/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div class="bg-[#fcfaf5] border border-red-300 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
        <div class="flex items-center space-x-2.5">
          <div class="w-7 h-7 rounded-lg bg-red-100 border border-red-300 flex items-center justify-center text-red-700">
            <Trash2 class="w-4 h-4" />
          </div>
          <h3 class="text-lg font-bold text-stone-900">Delete Tree Permanently</h3>
        </div>

        {#if deleteTreeError}
          <div class="bg-red-50 border border-red-300 text-red-900 rounded-lg p-2.5 text-xs font-medium">
            {deleteTreeError}
          </div>
        {/if}

        <div class="bg-red-50 border border-red-300 rounded-xl p-3.5 text-xs text-red-900 space-y-1.5">
          <p class="font-bold">This will permanently delete:</p>
          <ul class="list-disc list-inside space-y-0.5 text-red-800">
            <li>The tree <span class="font-semibold">"{activeTreeData.tree?.name}"</span></li>
            <li>{activeTreeData.individuals?.length || 0} people</li>
            <li>{activeTreeData.families?.length || 0} families</li>
            <li>All events, relationships and attached media records</li>
          </ul>
          <p class="text-red-700 pt-1">This action cannot be undone.</p>
        </div>

        <div>
          <label for="delete-tree-confirm" class="text-xs font-medium text-stone-600 block mb-1">
            Type <span class="font-bold text-red-700">{activeTreeData.tree?.name}</span> to confirm
          </label>
          <input
            id="delete-tree-confirm"
            type="text"
            bind:value={deleteTreeConfirmText}
            placeholder={activeTreeData.tree?.name}
            disabled={isDeletingTree}
            class="w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-2 text-xs text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 disabled:opacity-50"
          />
        </div>

        <div class="flex justify-end space-x-2 pt-3 border-t border-stone-200">
          <button
            type="button"
            onclick={() => (showDeleteTreeModal = false)}
            disabled={isDeletingTree}
            class="px-4 py-2 text-xs font-medium text-stone-600 hover:text-stone-900 rounded-lg hover:bg-stone-200/60 transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onclick={deleteTree}
            disabled={isDeletingTree || deleteTreeConfirmText !== activeTreeData.tree?.name}
            class="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold bg-red-700 hover:bg-red-600 text-white rounded-lg transition-colors cursor-pointer shadow-xs disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {#if isDeletingTree}
              <RefreshCw class="w-3.5 h-3.5 animate-spin mr-1" />
              <span>Deleting...</span>
            {:else}
              <Trash2 class="w-3.5 h-3.5" />
              <span>Delete Tree</span>
            {/if}
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

