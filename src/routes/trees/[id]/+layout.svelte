<script lang="ts">
	import { onMount, untrack, type Snippet } from 'svelte';
	import { goto, invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import AppHeader from '#lib/components/layout/AppHeader.svelte';
	import PersonFinder from '#lib/components/layout/PersonFinder.svelte';
	import TreeNav from '#lib/components/layout/TreeNav.svelte';
	import ToastHost from '#lib/components/feedback/ToastHost.svelte';
	import { ToastStore } from '#lib/components/feedback/toasts.svelte.js';
	import TreeEditorHost from '#lib/components/tree/TreeEditorHost.svelte';
	import TreeShellHost from '#lib/components/tree/TreeShellHost.svelte';
	import { setTreeContext, type FinderBridge } from '#lib/components/tree/tree-context.js';
	import { TreeEditor } from '#lib/components/tree/tree-editor.svelte.js';
	import { TreeShell } from '#lib/components/tree/tree-shell.svelte.js';
	import { MarksStore } from '#lib/components/layout/marks-store.svelte.js';
	import { DATA_KEY } from '#lib/services/load-helpers.js';
	import { searchPeopleApi } from '#lib/services/tree-api.js';
	import { canCreateRecords, isManagerOrAbove } from '#lib/shared/roles.js';
	import type { LayoutData } from './$types';

	interface Props {
		data: LayoutData;
		children: Snippet;
	}

	let { data, children }: Props = $props();

	const viewer = $derived(data.summary.viewer);
	// A non-member reading the public tree is in no list of theirs; they read it as a viewer.
	const role = $derived(
		data.trees.find((t) => t.id === data.summary.tree.id)?.role ??
			(viewer.isOutsider ? viewer.role : undefined)
	);
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
	const marks = new MarksStore(
		untrack(() => data.marks),
		untrack(() => data.summary.viewer.isPublicVisitor)
	);
	// A reload of the layout (after an edit, say) brings the server's lists; adopt them.
	$effect(() => marks.set(data.marks));
	const finderBridge: FinderBridge = { pickFocus: null, focusInput: null };
	let personFinder: PersonFinder | undefined = $state();
	$effect(() => {
		finderBridge.focusInput = () => personFinder?.focus();
		return () => (finderBridge.focusInput = null);
	});
	setTreeContext({
		toasts,
		editor,
		marks,
		finder: finderBridge,
		openNewTree: shell.openNewTree,
		get isPublicVisitor() {
			return viewer.isPublicVisitor;
		}
	});

	// Pages under a tree are rendered on the server, so a button can be seen before it works. This
	// marks the moment the page is interactive, for tests and for anything that must not click early.
	onMount(() => {
		document.body.dataset.hydrated = '';
		return () => delete document.body.dataset.hydrated;
	});
</script>

<svelte:head>
	<title>{data.summary.tree.name} · Epoch</title>
	{#if viewer.isTreePublic}
		<meta name="robots" content="noindex" />
	{/if}
</svelte:head>

{#if viewer.isPublicVisitor}
	<div
		role="note"
		class="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 bg-amber-100 px-4 py-1.5 text-xs font-medium text-amber-950"
	>
		<span>Public · read-only</span>
		<span aria-hidden="true">·</span>
		<a
			href="/login?next={encodeURIComponent(page.url.pathname + page.url.search)}"
			class="font-semibold underline"
		>
			Sign in
		</a>
	</div>
{/if}

<div class="flex min-h-screen flex-col bg-[#fcf9f2] font-sans text-stone-800">
	<AppHeader
		trees={data.trees}
		selectedTreeId={data.summary.tree.id}
		isImporting={shell.isImporting}
		onselectTree={(id) => void goto(treePath(id))}
		counts={data.summary.counts}
		onopenNewTree={shell.openNewTree}
		onopenDeleteTree={shell.openDeleteTree}
		onopenRenameTree={isManagerOrAbove(role) ? shell.openRenameTree : undefined}
		onopenAddPerson={canCreateRecords(role) ? editor.openAddPerson : undefined}
		onfileSelect={shell.selectFile}
		onexportGedcom={shell.exportGedcom}
		canExport={isManagerOrAbove(role)}
		canChangeTrees={!viewer.isPublicVisitor}
	>
		{#snippet finder()}
			<PersonFinder
				bind:this={personFinder}
				treeId={data.summary.tree.id}
				searchPeople={(q) => searchPeopleApi(data.summary.tree.id, q)}
				suggestions={marks}
				onpickFocus={isChartPage
					? (id) =>
							// The chart registers itself while it is mounted; with no chart to refocus (an empty
							// tree), the person's profile is the next best place to go.
							finderBridge.pickFocus
								? finderBridge.pickFocus(id)
								: void goto(personPath(data.summary.tree.id, id))
					: undefined}
				onnavigate={(href) => void goto(href)}
			/>
		{/snippet}
	</AppHeader>

	<!-- The chart is the one page that wants the whole window; the lists and forms stay readable at 7xl. -->
	<main
		class="mx-auto flex w-full flex-1 flex-col space-y-4 p-6 {isChartPage
			? 'max-w-none'
			: 'max-w-7xl'}"
	>
		<TreeShellHost
			{shell}
			tree={{
				id: data.summary.tree.id,
				name: data.summary.tree.name,
				version: data.summary.tree.version
			}}
		/>
		<TreeNav
			treeId={data.summary.tree.id}
			{role}
			pathname={page.url.pathname}
			isInstallOwner={viewer.isInstallOwner}
			treeCount={data.trees.length}
			isSignedIn={!viewer.isPublicVisitor}
			isOutsider={viewer.isOutsider}
		/>
		{@render children()}
	</main>
</div>

<TreeEditorHost {editor} />
<ToastHost store={toasts} />
