<script lang="ts">
	import { Globe, GlobeLock, RefreshCw } from '@lucide/svelte';
	import BaseModal from './BaseModal.svelte';

	interface Props {
		isOpen: boolean;
		/** The tree being made public or private. */
		treeName: string;
		/** True to withdraw the public tree, false to publish this one. */
		isWithdrawing: boolean;
		/** The tree that stops being public when this one replaces it; null when none is. */
		replacedName?: string | null;
		isSaving?: boolean;
		error?: string | null;
		onclose: () => void;
		/** Called with the typed name; the server checks it again. */
		onconfirm: (confirmName: string) => void;
	}

	let {
		isOpen,
		treeName,
		isWithdrawing,
		replacedName = null,
		isSaving = false,
		error = null,
		onclose,
		onconfirm
	}: Props = $props();

	// Two steps because a warning that shares a screen with its confirm button gets clicked past.
	let step = $state<'warn' | 'confirm'>('warn');
	let confirmText = $state('');

	$effect(() => {
		if (!isOpen) return;
		step = 'warn';
		confirmText = '';
	});

	const canConfirm = $derived(!isSaving && confirmText === treeName);
</script>

<BaseModal
	{isOpen}
	title={isWithdrawing ? 'Make tree private' : 'Make tree public'}
	icon={isWithdrawing ? GlobeLock : Globe}
	iconBgClass={isWithdrawing ? 'bg-emerald-100' : 'bg-amber-100'}
	iconBorderClass={isWithdrawing ? 'border-emerald-300' : 'border-amber-400'}
	iconTextClass={isWithdrawing ? 'text-emerald-800' : 'text-amber-800'}
	{error}
	{onclose}
>
	<div class="space-y-4">
		{#if step === 'warn'}
			{#if isWithdrawing}
				<p class="text-xs text-stone-700">
					<span class="font-semibold">"{treeName}"</span> will no longer be visible without signing in.
					Only its members will be able to open it.
				</p>
			{:else}
				<div
					class="space-y-1.5 rounded-xl border border-amber-400 bg-amber-50 p-3.5 text-xs text-amber-950"
				>
					<p class="font-bold">Anyone on the internet will be able to see this tree.</p>
					<p>
						Everyone in <span class="font-semibold">"{treeName}"</span> will be shown, including living
						people, except anyone marked private. Search engines are asked not to list it, but that is
						a request, not a lock.
					</p>
					{#if replacedName}
						<p>
							<span class="font-semibold">"{replacedName}"</span> will stop being public.
						</p>
					{/if}
				</div>
			{/if}
			<div class="flex justify-end space-x-2 border-t border-stone-200 pt-3">
				<button
					type="button"
					onclick={onclose}
					class="cursor-pointer rounded-lg px-4 py-2 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-200/60 hover:text-stone-900"
				>
					Cancel
				</button>
				<button
					type="button"
					onclick={() => (step = 'confirm')}
					class="cursor-pointer rounded-lg bg-stone-800 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-stone-700"
				>
					Continue
				</button>
			</div>
		{:else}
			<div>
				<label for="public-tree-confirm" class="mb-1 block text-xs font-medium text-stone-600">
					Type <span class="font-bold text-stone-900">{treeName}</span> to confirm
				</label>
				<input
					id="public-tree-confirm"
					type="text"
					bind:value={confirmText}
					placeholder={treeName}
					disabled={isSaving}
					autocomplete="off"
					class="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-xs text-stone-900 placeholder:text-stone-400 focus:border-amber-600 focus:ring-1 focus:ring-amber-600 focus:outline-none disabled:opacity-50"
				/>
			</div>
			<div class="flex justify-end space-x-2 border-t border-stone-200 pt-3">
				<button
					type="button"
					onclick={() => (step = 'warn')}
					disabled={isSaving}
					class="cursor-pointer rounded-lg px-4 py-2 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-200/60 hover:text-stone-900 disabled:opacity-50"
				>
					Back
				</button>
				<button
					type="button"
					onclick={() => onconfirm(confirmText)}
					disabled={!canConfirm}
					class="inline-flex cursor-pointer items-center space-x-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 {isWithdrawing
						? 'bg-emerald-800 hover:bg-emerald-700'
						: 'bg-amber-700 hover:bg-amber-600'}"
				>
					{#if isSaving}
						<RefreshCw class="mr-1 h-3.5 w-3.5 animate-spin" />
						<span>Saving...</span>
					{:else}
						<span>{isWithdrawing ? 'Make private' : 'Make public'}</span>
					{/if}
				</button>
			</div>
		{/if}
	</div>
</BaseModal>
