<script lang="ts">
	import { Plus, RefreshCw } from '@lucide/svelte';
	import BaseModal from './BaseModal.svelte';

	interface Props {
		isOpen: boolean;
		isCreating?: boolean;
		error?: string | null;
		onclose: () => void;
		oncreate: (data: { name: string; description?: string }) => void;
	}

	let { isOpen, isCreating = false, error = null, onclose, oncreate }: Props = $props();

	let name = $state('');
	let description = $state('');
	let localError = $state<string | null>(null);

	$effect(() => {
		if (isOpen) {
			name = '';
			description = '';
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
		localError = null;
		oncreate({ name: trimmed, description: description.trim() || undefined });
	}
</script>

<BaseModal
	{isOpen}
	title="Create New Genealogy Tree"
	icon={Plus}
	iconBgClass="bg-emerald-100"
	iconBorderClass="border-emerald-300"
	iconTextClass="text-emerald-800"
	error={error || localError}
	{onclose}
>
	<form onsubmit={handleSubmit} class="space-y-4">
		<div class="space-y-3.5">
			<div>
				<label for="tree-name-input" class="field-label">
					Tree Name <span class="text-orange-600">*</span>
				</label>
				<input
					id="tree-name-input"
					type="text"
					bind:value={name}
					placeholder="e.g. Smith Ancestry"
					disabled={isCreating}
					class="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 focus:outline-none disabled:opacity-50"
				/>
			</div>
			<div>
				<label for="tree-desc-input" class="field-label"> Description (Optional) </label>
				<textarea
					id="tree-desc-input"
					bind:value={description}
					placeholder="Lineage notes or family history details..."
					rows="3"
					disabled={isCreating}
					class="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 focus:outline-none disabled:opacity-50"
				></textarea>
			</div>
		</div>

		<div class="flex justify-end space-x-2 border-t border-stone-200 pt-2">
			<button
				type="button"
				onclick={onclose}
				disabled={isCreating}
				class="cursor-pointer rounded-lg px-4 py-2 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-200/60 hover:text-stone-900 disabled:opacity-50"
			>
				Cancel
			</button>
			<button type="submit" disabled={isCreating} class="btn-primary space-x-1.5">
				{#if isCreating}
					<RefreshCw class="mr-1 h-3.5 w-3.5 animate-spin" />
					<span>Creating...</span>
				{:else}
					<span>Create Tree</span>
				{/if}
			</button>
		</div>
	</form>
</BaseModal>
