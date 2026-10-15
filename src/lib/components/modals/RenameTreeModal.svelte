<script lang="ts">
	import { Pencil, RefreshCw } from '@lucide/svelte';
	import { MAX_TREE_SLUG_LENGTH, isValidTreeSlug } from '#lib/shared/tree-slug.js';
	import BaseModal from './BaseModal.svelte';

	interface Props {
		isOpen: boolean;
		/** The name as it stands, which the field starts with. */
		treeName: string;
		/** The address segment as it stands (ADR-045); null when the tree is reached by its id. */
		treeSlug: string | null;
		/** The tree's version when the dialog opened, sent back so a rename made meanwhile is refused. */
		treeVersion: number;
		isRenaming?: boolean;
		error?: string | null;
		onclose: () => void;
		/** `slug` is null to give up the address and be reached by the id. */
		onrename: (name: string, slug: string | null, version: number) => void;
	}

	let {
		isOpen,
		treeName,
		treeSlug,
		treeVersion,
		isRenaming = false,
		error = null,
		onclose,
		onrename
	}: Props = $props();

	let name = $state('');
	let slug = $state('');
	let localError = $state<string | null>(null);

	$effect(() => {
		if (isOpen) {
			name = treeName;
			slug = treeSlug ?? '';
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
		const nextSlug = slug.trim() || null;
		if (nextSlug !== null && !isValidTreeSlug(nextSlug)) {
			localError =
				'Use lower-case letters, digits and single hyphens in the address, such as the-windsors.';
			return;
		}
		if (trimmed === treeName && nextSlug === treeSlug) {
			onclose();
			return;
		}
		localError = null;
		onrename(trimmed, nextSlug, treeVersion);
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

		<div>
			<label for="tree-slug-input" class="field-label">Address</label>
			<div
				class="flex items-center rounded-lg border border-stone-300 bg-stone-50 focus-within:border-emerald-600 focus-within:ring-1 focus-within:ring-emerald-600"
			>
				<span class="pl-3 text-sm text-stone-500" aria-hidden="true">/trees/</span>
				<input
					id="tree-slug-input"
					type="text"
					bind:value={slug}
					maxlength={MAX_TREE_SLUG_LENGTH}
					disabled={isRenaming}
					autocomplete="off"
					spellcheck="false"
					placeholder="the-windsors"
					aria-describedby="tree-slug-help"
					class="w-full min-w-0 rounded-r-lg bg-transparent py-2 pr-3 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none disabled:opacity-50"
				/>
			</div>
			<p id="tree-slug-help" class="mt-1 text-xs text-stone-600">
				Renaming keeps the address, so bookmarks still work. Changing it breaks links to the old
				one. Leave it empty to use the tree's id.
			</p>
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
			<button type="submit" disabled={isRenaming} class="btn-primary space-x-1.5">
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
