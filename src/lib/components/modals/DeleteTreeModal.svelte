<script lang="ts">
	import { Trash2, RefreshCw } from 'lucide-svelte';
	import BaseModal from './BaseModal.svelte';
	import { previewTreeDeletionApi, type TreeImpact } from '#lib/services/tree-api.js';

	interface Props {
		show: boolean;
		treeId: string;
		treeName: string;
		isDeleting?: boolean;
		error?: string | null;
		onclose: () => void;
		ondelete: () => void;
	}

	let {
		show,
		treeId,
		treeName,
		isDeleting = false,
		error = null,
		onclose,
		ondelete
	}: Props = $props();

	let confirmText = $state('');
	let impact = $state<TreeImpact | null>(null);
	let previewError = $state<string | null>(null);

	// The counts come from the server, so the dialog lists what will really go rather than what the page happens to hold.
	$effect(() => {
		if (!show) return;
		confirmText = '';
		impact = null;
		previewError = null;
		let isStale = false;
		previewTreeDeletionApi(treeId)
			.then((counts) => {
				if (!isStale) impact = counts;
			})
			.catch((e: Error) => {
				if (!isStale) previewError = e.message;
			});
		return () => {
			isStale = true;
		};
	});

	let canDelete = $derived(!isDeleting && confirmText === treeName && impact !== null);
</script>

<BaseModal
	{show}
	title="Delete Tree Permanently"
	icon={Trash2}
	iconBgClass="bg-red-100"
	iconBorderClass="border-red-300"
	iconTextClass="text-red-700"
	error={error || previewError}
	{onclose}
>
	<div class="space-y-4">
		<div class="space-y-1.5 rounded-xl border border-red-300 bg-red-50 p-3.5 text-xs text-red-900">
			<p class="font-bold">This will permanently delete:</p>
			<ul class="list-inside list-disc space-y-0.5 text-red-800">
				<li>The tree <span class="font-semibold">"{treeName}"</span></li>
				{#if impact}
					<li>{impact.people} people</li>
					<li>{impact.unions} partnerships and {impact.links} parent and child links</li>
					<li>{impact.events} events and {impact.media} attachments</li>
					<li>The whole change history of this tree</li>
				{:else}
					<li>Counting what is in it…</li>
				{/if}
			</ul>
			<p class="pt-1 text-red-700">
				This action cannot be undone, and it cannot be undone from the history either.
			</p>
		</div>

		<div>
			<label for="delete-tree-confirm" class="mb-1 block text-xs font-medium text-stone-600">
				Type <span class="font-bold text-red-700">{treeName}</span> to confirm
			</label>
			<input
				id="delete-tree-confirm"
				type="text"
				bind:value={confirmText}
				placeholder={treeName}
				disabled={isDeleting}
				class="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-xs text-stone-900 placeholder:text-stone-400 focus:border-red-500 focus:ring-1 focus:ring-red-500 focus:outline-none disabled:opacity-50"
			/>
		</div>

		<div class="flex justify-end space-x-2 border-t border-stone-200 pt-3">
			<button
				type="button"
				onclick={onclose}
				disabled={isDeleting}
				class="cursor-pointer rounded-lg px-4 py-2 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-200/60 hover:text-stone-900 disabled:opacity-50"
			>
				Cancel
			</button>
			<button
				type="button"
				onclick={ondelete}
				disabled={!canDelete}
				class="inline-flex cursor-pointer items-center space-x-1.5 rounded-lg bg-red-700 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-40"
			>
				{#if isDeleting}
					<RefreshCw class="mr-1 h-3.5 w-3.5 animate-spin" />
					<span>Deleting...</span>
				{:else}
					<Trash2 class="h-3.5 w-3.5" />
					<span>Delete Tree</span>
				{/if}
			</button>
		</div>
	</div>
</BaseModal>
