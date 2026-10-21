<script lang="ts">
	import { Sparkles } from '@lucide/svelte';
	import ImportConfirmModal from '#lib/components/modals/ImportConfirmModal.svelte';
	import NewTreeModal from '#lib/components/modals/NewTreeModal.svelte';
	import type { TreeShell } from './tree-shell.svelte.js';

	interface Props {
		shell: TreeShell;
		/** The tree in view, which an import goes into; null on the landing page. */
		tree: { name: string } | null;
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
