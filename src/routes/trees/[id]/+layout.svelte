<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { goto, invalidate } from '$app/navigation';
  import { page } from '$app/state';
  import AppHeader from '#lib/components/layout/AppHeader.svelte';
  import MarksStrip from '#lib/components/layout/MarksStrip.svelte';
  import TreeNav from '#lib/components/layout/TreeNav.svelte';
  import TreeStatsBanner from '#lib/components/layout/TreeStatsBanner.svelte';
  import ToastHost from '#lib/components/feedback/ToastHost.svelte';
  import { ToastStore } from '#lib/components/feedback/toasts.svelte.js';
  import TreeEditorHost from '#lib/components/tree/TreeEditorHost.svelte';
  import TreeShellHost from '#lib/components/tree/TreeShellHost.svelte';
  import { setTreeContext } from '#lib/components/tree/tree-context.js';
  import { TreeEditor } from '#lib/components/tree/tree-editor.svelte.js';
  import { TreeShell } from '#lib/components/tree/tree-shell.svelte.js';
  import { DATA_KEY } from '#lib/services/load-helpers.js';
  import type { LayoutData } from './$types';

  interface Props {
    data: LayoutData;
    children: Snippet;
  }

  let { data, children }: Props = $props();

  const treePath = (id: string) => `/trees/${encodeURIComponent(id)}`;
  const personPath = (treeId: string, personId: string) => `${treePath(treeId)}/people/${encodeURIComponent(personId)}`;

  // Toasts and the editor outlive any one screen: "Person deleted, Undo" has to appear on the
  // screen the person was deleted from, which is a different screen from the one that showed them.
  const toasts = new ToastStore();
  const reload = () => invalidate(DATA_KEY);
  const editor = new TreeEditor({
    treeId: () => data.summary.tree.id,
    toasts,
    refresh: reload,
    onPersonCreated: (personId) => void goto(personPath(data.summary.tree.id, personId)),
    onPersonDeleted: async (personId) => {
      // A page about a person who no longer exists has nothing to show; go back to the tree.
      if (page.params.personId === personId) await goto(treePath(data.summary.tree.id), { replace: true });
    }
  });
  const shell = new TreeShell({
    treeId: () => data.summary.tree.id,
    toasts,
    reload,
    goTo: (id) => void goto(id ? treePath(id) : '/')
  });
  setTreeContext({ toasts, editor });

  // Pages under a tree are rendered on the server, so a button can be seen before it works. This
  // marks the moment the page is interactive, for tests and for anything that must not click early.
  onMount(() => {
    document.body.dataset.hydrated = '';
    return () => delete document.body.dataset.hydrated;
  });
</script>

<svelte:head>
  <title>{data.summary.tree.name} · Epoch</title>
</svelte:head>

<div class="min-h-screen bg-[#fcf9f2] text-stone-800 flex flex-col font-sans">
  <AppHeader
    trees={data.trees}
    selectedTreeId={data.summary.tree.id}
    isImporting={shell.isImporting}
    onselectTree={(id) => void goto(treePath(id))}
    onopenNewTree={shell.openNewTree}
    onopenDeleteTree={shell.openDeleteTree}
    onopenAddPerson={editor.openAddPerson}
    onfileSelect={shell.selectFile}
    onexportGedcom={shell.exportGedcom}
  />

  <main class="flex-1 p-6 flex flex-col space-y-4 max-w-7xl w-full mx-auto">
    <TreeShellHost {shell} tree={{ id: data.summary.tree.id, name: data.summary.tree.name }} />
    <TreeStatsBanner treeName={data.summary.tree.name} people={data.summary.counts.people} unions={data.summary.counts.unions} />
    <TreeNav treeId={data.summary.tree.id} />
    <MarksStrip treeId={data.summary.tree.id} marks={data.marks} />
    {@render children()}
  </main>
</div>

<TreeEditorHost {editor} />
<ToastHost store={toasts} />
