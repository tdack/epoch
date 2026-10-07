<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { Landmark } from '@lucide/svelte';
	import BaseModal from '#lib/components/modals/BaseModal.svelte';
	import { createRepositoryApi, isConflict, updateRepositoryApi } from '#lib/services/tree-api.js';
	import type { RepositoryListItem } from '#lib/shared/evidence.js';
	import type { ChangeSummary } from '#lib/types/genealogy.js';

	interface Props {
		isOpen: boolean;
		treeId: string;
		/** The repository being edited, or null to make one. */
		repository: Pick<RepositoryListItem, 'id' | 'version' | 'name' | 'address'> | null;
		onsaved: (change: ChangeSummary | null, repositoryId: string) => void | Promise<void>;
		onstale: (message: string) => void | Promise<void>;
		oncancel: () => void;
	}

	let { isOpen, treeId, repository, onsaved, onstale, oncancel }: Props = $props();

	let name = $state('');
	let address = $state('');
	let error = $state<string | null>(null);
	let isSaving = $state(false);
	let nameInput = $state<HTMLInputElement | null>(null);

	const field =
		'w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600';

	$effect(() => {
		if (!isOpen) return;
		const from = untrack(() => repository);
		name = from?.name ?? '';
		address = from?.address ?? '';
		error = null;
		void tick().then(() => nameInput?.focus());
	});

	async function save() {
		if (!name.trim()) {
			error = 'Give the repository a name.';
			return;
		}
		isSaving = true;
		error = null;
		const input = { name: name.trim(), address: address.trim() || null };
		try {
			if (repository) {
				const { change } = await updateRepositoryApi(
					treeId,
					repository.id,
					input,
					repository.version
				);
				await onsaved(change, repository.id);
			} else {
				const created = await createRepositoryApi(treeId, input);
				await onsaved(created.change, created.repositoryId);
			}
		} catch (cause: unknown) {
			if (isConflict(cause)) await onstale(cause.message);
			else error = (cause as Error).message || 'Could not save the repository';
		} finally {
			isSaving = false;
		}
	}
</script>

<BaseModal
	{isOpen}
	title={repository ? 'Edit repository' : 'Add a repository'}
	icon={Landmark}
	{error}
	onclose={oncancel}
>
	<form
		class="space-y-3"
		data-testid="repository-form"
		onsubmit={(event) => {
			event.preventDefault();
			void save();
		}}
	>
		<div>
			<label for="repository-name" class="field-label">Name</label>
			<input
				id="repository-name"
				type="text"
				bind:this={nameInput}
				bind:value={name}
				class={field}
				placeholder="e.g. West Yorkshire Archive Service"
			/>
		</div>
		<div>
			<label for="repository-address" class="field-label"
				>Address <span class="font-normal text-stone-500">(optional)</span></label
			>
			<textarea id="repository-address" rows="3" bind:value={address} class={field}></textarea>
		</div>
		<div class="flex gap-2 pt-1">
			<button
				type="button"
				onclick={oncancel}
				class="flex-1 cursor-pointer rounded-lg bg-stone-200 py-2 font-semibold text-stone-700 hover:bg-stone-300"
				>Cancel</button
			>
			<button
				type="submit"
				disabled={isSaving}
				class="flex-1 cursor-pointer rounded-lg bg-emerald-800 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
				>{isSaving ? 'Saving…' : repository ? 'Save repository' : 'Add repository'}</button
			>
		</div>
	</form>
</BaseModal>
