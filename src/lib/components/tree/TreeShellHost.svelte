<script lang="ts">
	import { Sparkles } from '@lucide/svelte';
	import DeleteTreeModal from '#lib/components/modals/DeleteTreeModal.svelte';
	import ImportConfirmModal from '#lib/components/modals/ImportConfirmModal.svelte';
	import NewTreeModal from '#lib/components/modals/NewTreeModal.svelte';
	import RenameTreeModal from '#lib/components/modals/RenameTreeModal.svelte';
	import type { TreeShell } from './tree-shell.svelte.js';

	interface Props {
		shell: TreeShell;
		/** The tree in view, for the rename, delete and import dialogs; null on the landing page. */
		tree: { id: string; slug: string | null; name: string; version: number } | null;
	}

	let { shell, tree }: Props = $props();
</script>

{#if shell.importStatus}
	<div
		class="mx-auto mb-4 flex w-full max-w-7xl items-center justify-between rounded-xl border border-amber-300/80 bg-amber-50/90 p-3.5 text-xs text-amber-950 shadow-xs"
	>
		<div class="flex items-center space-x-2">
			<Sparkles class="h-4 w-4 shrink-0 text-amber-700" />
			<span class="font-medium">{shell.importStatus}</span>
		</div>
		<button
			type="button"
			onclick={() => (shell.importStatus = null)}
			class="ml-4 cursor-pointer font-semibold text-amber-800 hover:text-amber-950"
		>
			Dismiss
		</button>
	</div>
{/if}

<NewTreeModal
	isOpen={shell.isNewTreeModalOpen}
	isCreating={shell.isCreatingTree}
	error={shell.createTreeError}
	onclose={() => (shell.isNewTreeModalOpen = false)}
	oncreate={shell.createTree}
/>

{#if tree}
	<RenameTreeModal
		isOpen={shell.isRenameTreeModalOpen}
		treeName={tree.name}
		treeSlug={tree.slug}
		treeVersion={tree.version}
		isRenaming={shell.isRenamingTree}
		error={shell.renameTreeError}
		onclose={() => (shell.isRenameTreeModalOpen = false)}
		onrename={(name, slug, version) => shell.renameTree(name, slug, version, tree.slug)}
	/>
	<DeleteTreeModal
		isOpen={shell.isDeleteTreeModalOpen}
		treeId={tree.id}
		treeName={tree.name}
		isDeleting={shell.isDeletingTree}
		error={shell.deleteTreeError}
		onclose={() => (shell.isDeleteTreeModalOpen = false)}
		ondelete={shell.deleteTree}
	/>
{/if}

<ImportConfirmModal
	isOpen={shell.isImportConfirmModalOpen}
	treeName={tree?.name}
	hasSelectedTree={tree !== null}
	preview={shell.importPreview}
	isLoadingPreview={shell.isLoadingPreview}
	isConfirming={shell.isConfirmingImport}
	error={shell.importConfirmError}
	onclose={shell.cancelImport}
	onconfirm={shell.confirmImport}
/>
