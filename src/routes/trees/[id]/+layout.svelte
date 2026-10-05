<script lang="ts">
	import { onMount, untrack, type Snippet } from 'svelte';
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
	import { MarksStore } from '#lib/components/layout/marks-store.svelte.js';
	import { DATA_KEY } from '#lib/services/load-helpers.js';
	import { isManagerOrAbove } from '#lib/shared/roles.js';
	import type { LayoutData } from './$types';

	interface Props {
		data: LayoutData;
		children: Snippet;
	}

	let { data, children }: Props = $props();

	const role = $derived(data.trees.find((t) => t.id === data.summary.tree.id)?.role);
	const isChartPage = $derived(page.route.id === '/trees/[id]');
	const treePath = (id: string) => `/trees/${encodeURIComponent(id)}`;
	const personPath = (treeId: string, personId: string) =>
		`${treePath(treeId)}/people/${encodeURIComponent(personId)}`;

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
			if (page.params.personId === personId)
				await goto(treePath(data.summary.tree.id), { replace: true });
		}
	});
	const shell = new TreeShell({
		treeId: () => data.summary.tree.id,
		toasts,
		reload,
		goTo: (id) => void goto(id ? treePath(id) : '/')
	});
	// Seeded once so the server render already has the lists; the effect below adopts any later load.
	const marks = new MarksStore(untrack(() => data.marks));
	// A reload of the layout (after an edit, say) brings the server's lists; adopt them.
	$effect(() => marks.set(data.marks));
	setTreeContext({ toasts, editor, marks });

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

<div class="flex min-h-screen flex-col bg-[#fcf9f2] font-sans text-stone-800">
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
		canExport={isManagerOrAbove(role)}
	/>

	<!-- The chart is the one page that wants the whole window; the lists and forms stay readable at 7xl. -->
	<main
		class="mx-auto flex w-full flex-1 flex-col space-y-4 p-6 {isChartPage
			? 'max-w-none'
			: 'max-w-7xl'}"
	>
		<TreeShellHost {shell} tree={{ id: data.summary.tree.id, name: data.summary.tree.name }} />
		<TreeStatsBanner
			treeName={data.summary.tree.name}
			people={data.summary.counts.people}
			unions={data.summary.counts.unions}
		/>
		<TreeNav treeId={data.summary.tree.id} {role} />
		<MarksStrip treeId={data.summary.tree.id} {marks} />
		{@render children()}
	</main>
</div>

<TreeEditorHost {editor} />
<ToastHost store={toasts} />
