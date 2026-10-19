<script lang="ts">
	import { GitBranch, RefreshCw } from '@lucide/svelte';
	import BaseModal from '#lib/components/modals/BaseModal.svelte';
	import { MAX_SUBTREE_NAME_LENGTH } from '#lib/shared/subtrees.js';
	import { MAX_TREE_SLUG_LENGTH, isValidTreeSlug, slugifyTreeName } from '#lib/shared/tree-slug.js';

	interface Props {
		isOpen: boolean;
		/** Create names a new sub-tree after a root; edit renames or re-addresses an existing one. */
		mode: 'create' | 'edit';
		/** The name the field starts with. */
		initialName: string;
		/** The address segment the field starts with; empty on create, where it follows the name. */
		initialSlug?: string;
		/** The root person, shown read-only on create. Changing a root is a separate action. */
		rootName?: string | null;
		isSaving?: boolean;
		/** The server's refusal (a taken address, say), shown inline. */
		error?: string | null;
		onclose: () => void;
		onsave: (name: string, slug: string) => void;
	}

	let {
		isOpen,
		mode,
		initialName,
		initialSlug = '',
		rootName = null,
		isSaving = false,
		error = null,
		onclose,
		onsave
	}: Props = $props();

	const uid = $props.id();
	let name = $state('');
	let slug = $state('');
	// Once the address is typed by hand it stops following the name, so a later name edit cannot undo it.
	let isSlugEdited = $state(false);
	let localError = $state<string | null>(null);

	$effect(() => {
		if (isOpen) {
			name = initialName;
			slug = initialSlug || (slugifyTreeName(initialName) ?? '');
			isSlugEdited = initialSlug !== '';
			localError = null;
		}
	});

	function onNameInput() {
		if (!isSlugEdited) slug = slugifyTreeName(name) ?? '';
	}

	function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		const trimmed = name.trim();
		const nextSlug = slug.trim();
		if (!trimmed) {
			localError = 'Please enter a name for the sub-tree.';
			return;
		}
		if (!isValidTreeSlug(nextSlug)) {
			localError =
				'Use lower-case letters, digits and single hyphens in the address, such as bouvier-line.';
			return;
		}
		localError = null;
		onsave(trimmed, nextSlug);
	}

	const inputClass =
		'w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 focus:outline-none disabled:opacity-50';
</script>

<BaseModal
	{isOpen}
	title={mode === 'create' ? 'Make Sub-tree' : 'Edit Sub-tree'}
	icon={GitBranch}
	error={error || localError}
	{onclose}
>
	<form onsubmit={handleSubmit} class="space-y-4">
		{#if mode === 'create' && rootName}
			<div>
				<span class="field-label">Anchor person</span>
				<p class="text-sm font-medium text-stone-900" data-testid="subtree-root">{rootName}</p>
				<p class="mt-1 text-xs text-stone-600">
					The sub-tree covers this person's descendants and their partners.
				</p>
			</div>
		{/if}

		<div>
			<label for="{uid}-name" class="field-label">
				Name <span class="text-orange-600">*</span>
			</label>
			<input
				id="{uid}-name"
				type="text"
				bind:value={name}
				oninput={onNameInput}
				maxlength={MAX_SUBTREE_NAME_LENGTH}
				disabled={isSaving}
				class={inputClass}
			/>
		</div>

		<div>
			<label for="{uid}-slug" class="field-label">Address</label>
			<input
				id="{uid}-slug"
				type="text"
				bind:value={slug}
				oninput={() => (isSlugEdited = true)}
				maxlength={MAX_TREE_SLUG_LENGTH}
				disabled={isSaving}
				autocomplete="off"
				spellcheck="false"
				placeholder="bouvier-line"
				aria-describedby="{uid}-slug-help"
				class={inputClass}
			/>
			<p id="{uid}-slug-help" class="mt-1 text-xs text-stone-600">
				Added to the tree's address after a tilde. Changing it breaks links to the old one.
			</p>
		</div>

		<div class="flex justify-end space-x-2 border-t border-stone-200 pt-2">
			<button
				type="button"
				onclick={onclose}
				disabled={isSaving}
				class="cursor-pointer rounded-lg px-4 py-2 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-200/60 hover:text-stone-900 disabled:opacity-50"
			>
				Cancel
			</button>
			<button type="submit" disabled={isSaving} class="btn-primary space-x-1.5">
				{#if isSaving}
					<RefreshCw class="mr-1 h-3.5 w-3.5 animate-spin" />
					<span>Saving...</span>
				{:else}
					<span>{mode === 'create' ? 'Make sub-tree' : 'Save'}</span>
				{/if}
			</button>
		</div>
	</form>
</BaseModal>
