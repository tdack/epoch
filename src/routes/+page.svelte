<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { signOutHref } from '#lib/shared/access.js';
	import AppHeader from '#lib/components/layout/AppHeader.svelte';
	import SourceLink from '#lib/components/layout/SourceLink.svelte';
	import ToastHost from '#lib/components/feedback/ToastHost.svelte';
	import { ToastStore } from '#lib/components/feedback/toasts.svelte.js';
	import TreeShellHost from '#lib/components/tree/TreeShellHost.svelte';
	import { TreeShell } from '#lib/components/tree/tree-shell.svelte.js';

	let { data } = $props();

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
		onopenAddPerson={() => {}}
		onfileSelect={shell.selectFile}
		viewer={data.viewer}
		signOutHref={signOutHref(page.url.origin)}
	/>
	<main class="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center p-6">
		<TreeShellHost {shell} tree={null} />
		<h1 class="text-2xl font-bold text-stone-900">Start your family tree</h1>
		<p class="mt-2 text-sm text-stone-600">
			You have no trees yet. Create an empty one, or import a GEDCOM file.
		</p>
		<div>
			<button type="button" onclick={shell.openNewTree} class="btn-primary mt-5">
				Create a tree
			</button>
		</div>
	</main>
	<footer class="px-6 pb-4 text-center">
		<SourceLink href={data.sourceUrl} commit={data.sourceCommit} />
	</footer>
</div>
<ToastHost store={toasts} />
