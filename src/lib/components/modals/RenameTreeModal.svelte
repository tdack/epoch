<script lang="ts">
	import { Pencil, RefreshCw } from '@lucide/svelte';
	import BaseModal from './BaseModal.svelte';

	interface Props {
		isOpen: boolean;
		/** The name as it stands, which the field starts with. */
		treeName: string;
		/** The tree's version when the dialog opened, sent back so a rename made meanwhile is refused. */
		treeVersion: number;
		isRenaming?: boolean;
		error?: string | null;
		onclose: () => void;
		onrename: (name: string, version: number) => void;
	}

	let {
		isOpen,
		treeName,
		treeVersion,
		isRenaming = false,
		error = null,
		onclose,
		onrename
	}: Props = $props();

	let name = $state('');
	let localError = $state<string | null>(null);

	$effect(() => {
		if (isOpen) {
			name = treeName;
			localError = null;
		}
	});

	function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		const trimmed = name.trim();
		if (!trimmed) {
			localError = 'Please enter a name for your tree.';
			return;
		}
		if (trimmed === treeName) {
			onclose();
			return;
		}
		localError = null;
		onrename(trimmed, treeVersion);
	}
</script>

<BaseModal
	{isOpen}
	title="Rename Tree"
	icon={Pencil}
	iconBgClass="bg-emerald-100"
	iconBorderClass="border-emerald-300"
	iconTextClass="text-emerald-800"
	error={error || localError}
	{onclose}
>
	<form onsubmit={handleSubmit} class="space-y-4">
		<div>
			<label for="tree-rename-input" class="field-label">
				Tree Name <span class="text-orange-600">*</span>
			</label>
			<input
				id="tree-rename-input"
				type="text"
				bind:value={name}
				maxlength={200}
				disabled={isRenaming}
				class="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 focus:outline-none disabled:opacity-50"
			/>
		</div>

		<div class="flex justify-end space-x-2 border-t border-stone-200 pt-2">
			<button
				type="button"
				onclick={onclose}
				disabled={isRenaming}
				class="cursor-pointer rounded-lg px-4 py-2 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-200/60 hover:text-stone-900 disabled:opacity-50"
			>
				Cancel
			</button>
			<button
				type="submit"
				disabled={isRenaming}
				class="inline-flex cursor-pointer items-center space-x-1.5 rounded-lg bg-emerald-800 px-4 py-2 text-xs font-semibold text-amber-50 shadow-xs transition-colors hover:bg-emerald-700 disabled:opacity-50"
			>
				{#if isRenaming}
					<RefreshCw class="mr-1 h-3.5 w-3.5 animate-spin" />
					<span>Renaming...</span>
				{:else}
					<span>Rename Tree</span>
				{/if}
			</button>
		</div>
	</form>
</BaseModal>
