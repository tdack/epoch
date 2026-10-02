<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import AppHeader from '#lib/components/layout/AppHeader.svelte';
	import ToastHost from '#lib/components/feedback/ToastHost.svelte';
	import { ToastStore } from '#lib/components/feedback/toasts.svelte.js';
	import TreeShellHost from '#lib/components/tree/TreeShellHost.svelte';
	import { TreeShell } from '#lib/components/tree/tree-shell.svelte.js';

	const toasts = new ToastStore();
	const shell = new TreeShell({
		treeId: () => null,
		toasts,
		reload: () => invalidateAll(),
		goTo: (id) => void goto(id ? `/trees/${encodeURIComponent(id)}` : '/')
	});
</script>

<svelte:head>
	<title>Epoch</title>
</svelte:head>

<div class="flex min-h-screen flex-col bg-[#fcf9f2] font-sans text-stone-800">
	<AppHeader
		trees={[]}
		selectedTreeId={null}
		isImporting={shell.isImporting}
		onselectTree={() => {}}
		onopenNewTree={shell.openNewTree}
		onopenDeleteTree={() => {}}
		onopenAddPerson={() => {}}
		onfileSelect={shell.selectFile}
		onexportGedcom={() => {}}
	/>
	<main class="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center p-6">
		<TreeShellHost {shell} tree={null} />
		<h2 class="text-2xl font-bold text-stone-900">Start your family tree</h2>
		<p class="mt-2 text-sm text-stone-600">
			You have no trees yet. Create an empty one, or import a GEDCOM file.
		</p>
		<div>
			<button
				type="button"
				onclick={shell.openNewTree}
				class="mt-5 cursor-pointer rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-amber-50 hover:bg-emerald-700"
			>
				Create a tree
			</button>
		</div>
	</main>
</div>
<ToastHost store={toasts} />
