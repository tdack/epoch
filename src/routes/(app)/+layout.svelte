<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { signOutHref } from '#lib/shared/access.js';
	import { treeAdminPage } from '#lib/shared/roles.js';
	import { treePath } from '#lib/shared/tree-slug.js';
	import AppHeader from '#lib/components/layout/AppHeader.svelte';
	import SourceLink from '#lib/components/layout/SourceLink.svelte';
	import ToastHost from '#lib/components/feedback/ToastHost.svelte';
	import { ToastStore } from '#lib/components/feedback/toasts.svelte.js';
	import TreeShellHost from '#lib/components/tree/TreeShellHost.svelte';
	import { TreeShell } from '#lib/components/tree/tree-shell.svelte.js';
	import type { Snippet } from 'svelte';
	import type { LayoutData } from './$types';

	interface Props {
		data: LayoutData;
		children: Snippet;
	}

	let { data, children }: Props = $props();

	const toasts = new ToastStore();
	const shell = new TreeShell({
		treeId: () => null,
		toasts,
		reload: () => invalidateAll(),
		goTo: (id) => void goto(id ? `/trees/${encodeURIComponent(id)}` : '/')
	});

	function selectTree(id: string) {
		const tree = data.trees.find((t) => t.id === id);
		void goto(tree ? treePath(tree) : `/trees/${encodeURIComponent(id)}`);
	}
</script>

<!-- The header the tree pages and `/` share, with no tree open (ADR-075). -->
<div class="flex min-h-screen flex-col bg-[#fcf9f2] font-sans text-stone-800">
	<AppHeader
		trees={data.trees}
		selectedTreeId={null}
		isImporting={shell.isImporting}
		onselectTree={selectTree}
		onopenNewTree={shell.openNewTree}
		onopenAddPerson={() => {}}
		onfileSelect={shell.selectFile}
		settingsHref={(t) => {
			const admin = treeAdminPage(t.role);
			return admin && `${treePath(t)}/${admin}`;
		}}
		viewer={data.viewer}
		adminHref={data.isInstallOwner ? '/admin' : undefined}
		signOutHref={signOutHref(page.url.origin)}
	/>
	<!-- The same column as a tree's pages, so Account and Administration line up with Tree settings. -->
	<main class="mx-auto w-full max-w-7xl flex-1 p-6">
		<TreeShellHost {shell} tree={null} />
		{@render children()}
	</main>
	<footer class="px-6 pb-4 text-center">
		<SourceLink href={data.sourceUrl} commit={data.sourceCommit} />
	</footer>
</div>
<ToastHost store={toasts} />
